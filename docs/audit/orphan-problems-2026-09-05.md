# Orphan Problems — 2026-09-05

Problems with no owner, found by sweeping for drift between what the code says, what the config says, and what actually runs. Each one was verified against the working tree today, not inferred from docs or the knowledge graph. Ranked by worth-fixing, not by size.

| # | Problem | Evidence | Why it matters | Fix | Effort |
|---|---|---|---|---|---|
| 1 | **The SSRF guard exists and nothing calls it.** `safeFetch` (DNS-resolves, rejects private/reserved IPs) has zero call sites. `read_appearance_from_image` accepts a user-supplied `imageUrl`; on the Gemini path `fetchImageInlineData` fetches it server-side with plain `fetchWithTimeout`. | [safe-fetch.ts:81](../../personagen-svelte/src/lib/server/safe-fetch.ts#L81) exported, only imported by `changelog.ts` and never invoked · [ai-client.ts:60-72](../../personagen-svelte/src/lib/server/ai-client.ts#L60-L72) · [engine/+server.ts:2504](../../personagen-svelte/src/routes/api/engine/+server.ts#L2504) | A logged-in user can make the server fetch `http://supabase-kong:8000/…` or any EasyPanel-internal hostname and get the bytes back base64-encoded inside a Gemini request. The guard was written for exactly this and then orphaned. | Route `fetchImageInlineData` through `safeFetch`; at the engine, require `https:` and (preferably) our own storage host for `imageUrl`. Add a spec: private IP → rejected. | S |
| 2 | **`personas_profile_migration.sql` is missing from the bootstrap.** `build-bootstrap.mjs` ORDER ends at `model_registry_multimode`; `client_bootstrap.sql` contains zero mentions of `personas_profile`. | [build-bootstrap.mjs:36-61](../../personagen-svelte/supabase/build-bootstrap.mjs#L36-L61) · `grep -c personas_profile client_bootstrap.sql` → 0 | Any database created from the bootstrap (the client EasyPanel handover) never gets the column. The never-brick fallback then writes the profile into `market` forever, and the planned `market` retirement (P0.6) would strand those rows. | Add the file to ORDER, regenerate `client_bootstrap.sql`, add a spec that every `*_migration.sql` is either in ORDER, in `apply_all_pending.sql`, or on an explicit exclusion list with a reason. | S |
| 3 | **The failing budget test is a stale expectation, not a bug — and nobody updated it.** Per-seat spend caps (2026-08-27) added `seatCapExceeded`, which runs an `agents` lookup on every call; the 2026-07-25 spec asserts zero queries when env caps are 0. | [budget.ts:150-160](../../personagen-svelte/src/lib/server/budget.ts#L150-L160) · [budget.spec.ts:111-117](../../personagen-svelte/src/lib/server/budget.spec.ts#L111-L117) · blame: spec last touched `0d9975c`, seat caps landed `8e7c829` | The suite has been red for nine days. A red suite cannot gate anything, which is the readiness doc's own Phase 0 rule. | Scope the assertion to "no `generation_events` query for env caps" (seat caps are a separate, workspace-set feature). Add a sibling test: no workspace → exactly one `agents` query and nothing else. | XS |
| 4 | **The profile "normalising gate" is never used on a write.** `serializePersonaProfile` documents itself as the coercion gate; the config route calls only `mergePersonaProfile`, and the create route stores the raw object. Meanwhile the wizard uses free-text `<input>`s for archetype and content focus while the persona page uses `<select>`s with no off-list guard (only niche has one). | [config/+server.ts:103-110](../../personagen-svelte/src/routes/api/agents/config/+server.ts#L103-L110) · [agents/+server.ts:33-49](../../personagen-svelte/src/routes/api/agents/+server.ts#L33-L49) · [generator/+page.svelte:636-650](../../personagen-svelte/src/routes/(portal)/generator/+page.svelte#L636-L650) · persona page guard exists only at line 3760 | A user who types "Mentor" in the wizard gets a persona whose archetype renders as a blank select on the persona page, while the prompt still receives "Mentor". Two surfaces disagree about the same field and neither knows. | Serialize on both write paths; add the niche-style off-list guard to the archetype and focus selects (keeps legacy values visible); make the wizard inputs `<select>` or `<datalist>`. | S |
| 5 | **38 environment variables, no `.env.example`, README documents one.** | `grep -rhoE "env\.[A-Z_]+"` → 38 distinct names; `.env.example` absent; README mentions only `USER_SECRETS_ENCRYPTION_KEY` | The client deploy was blocked for weeks on env repair (memory: EasyPanel handover). Every undocumented var is a future outage that only the person who added it can diagnose. `UGC_QUALITY_FLOOR`, `PUBLISH_ENFORCE_ACTIVE_HOURS`, `ADMIN_PIN`, `UGC_EXTRA_VOICES`, `MAX_*_SPEND_*` are all behaviour-changing and invisible. | Generate `.env.example` with one comment per var (required/optional, default, effect). Add a unit test that greps `env.X` references and fails when one has no line in `.env.example`. | S |
| 6 | **Five comments justify a dual-write with a false claim.** "services/mcp-bridge still reads `agents.market`" appears in the store, both agent routes, `types.ts`, and the migration. The bridge selects only `id, name, handle, niche, status, managed_by_overseer, runtime_owner, is_overseer, supervisor_agent_id, user_id`. | [persona-profile-store.ts:343](../../personagen-svelte/src/lib/persona-profile-store.ts#L343) · [agents/+server.ts:31](../../personagen-svelte/src/routes/api/agents/+server.ts#L31) · [config/+server.ts:92](../../personagen-svelte/src/routes/api/agents/config/+server.ts#L92) · `services/mcp-bridge/server.js` L111, L306, L377, L413 | A false blocker keeps a known data-model wart (profile JSON in a country column) alive. Anyone reading the comment will correctly refuse to remove the dual-write. | Correct the comments now; retire the dual-write as its own migration (plan P0.6). | XS |
| 7 | **The vision read-back fills 9 of 14 appearance keys and re-creates the legacy combined value.** Its prompt asks for `hairstyle: hair length and style`, so a pinned-face read writes "long wavy" into `hairstyle`, the exact shape `hairDescriptor` has a de-duplication hack for. It never fills `personaAge`, `skinTone`, `bodyType`, `hairLength`. | [engine/+server.ts:2508-2519](../../personagen-svelte/src/routes/api/engine/+server.ts#L2508-L2519) · [persona-profile.ts:296-305](../../personagen-svelte/src/lib/persona-profile.ts#L296-L305) | "Read from photo" is the feature meant to make the config match the face. It leaves the four fields that lead the portrait clause unset and keeps feeding the bug the hack exists for. | Ask for all 14 keys, with the curated option lists inlined for the chip-backed ones, and split length from style. | XS |
| 8 | **63 `state_referenced_locally` warnings, a real bug class, 44 in one file.** `let x = $state(data.foo)` captures the initial value; on client-side navigation to another persona or after a `data` refresh, the state is stale. The persona page has a hand-rolled resync; the other 11 files do not. | `npm run check` → 58 + 5 of this warning across 12 files: persona page 44, settings 6, favorites 2, brand-brief 2, CalendarView 2, and one each in trash, models, generator, generations, developer, calendar, intel | Silent stale UI after navigation. Settings (6) is the one most likely to show a previous state after a save. | Triage per file: `$derived` where it is a projection, `$effect` re-seed where it is editable state. Persona page last, since its resync works. | M |
| 9 | **88 derived cache files are committed, and one of them changes every session.** `graphify-out/cache/**` is tracked; `last_query_stamp` is dirty in `git status` on every session start. No root `.gitignore` entry. | `git ls-files graphify-out/cache` → 88 · `git status` at session start | Constant noise in every diff and a guaranteed conflict source between concurrent sessions, which the insights report names as the top friction. The cache is regenerable by design. | Add `graphify-out/cache/` to root `.gitignore`; `git rm -r --cached graphify-out/cache`. Keep the graph outputs tracked. | XS |
| 10 | **A one-off account rename with a real customer email is committed as a migration-shaped file.** `supabase/update_user.sql` rewrites `auth.users` and `auth.identities` for a specific address; not in any bootstrap list; untouched since 2026-06-09. | [update_user.sql](../../personagen-svelte/supabase/update_user.sql) | Looks like a migration, would be catastrophic if run against the wrong project, and carries PII in the repo. | Delete it (history retains it) or move to `docs/archive/` with a header saying it was applied once. | XS |
| 11 | **The two files that produce every prompt have no tests.** `generate.ts` (4,159 lines) exports its prompt builders "so the UI can show the real prompt", and `engine/+server.ts` (2,666 lines) holds every persona prompt. Neither has a spec. | `find src -name "*.spec.ts"` → 10 files, none covering either | Any prompt edit is unreviewable at the byte level, which is how the Campaign Planner / persona-persistence "shipped but different in prod" incidents happen. | Snapshot the exported builders against fixed fixtures (plan P0.7 does this for persona prompts; extend to script/caption/card prompts). | S |

## Not problems (checked and cleared)

- **Committed secrets:** scanned for OpenRouter, Supabase JWT, Google, and 32-hex key shapes across `.ts .svelte .md .sql .json .js .yml .ps1` — nothing found.
- **`TODO`/`FIXME`/`HACK`:** zero in `src/`. Debt is carried in prose comments instead, which is why #6 could go stale unnoticed.
- **Ledger truncation:** `LEDGER_ROW_LIMIT` is handled at [budget.ts:58](../../personagen-svelte/src/lib/server/budget.ts#L58) — fails closed when the limit is hit.
- **`docs/monetization/credit-system-forensic-assessment-and-plan.md`:** untracked, written today by another session. Not touched; noted so it is not mistaken for an orphan.

## Status — end of 2026-09-05

Two sessions worked this list in the same tree. Ownership below is by who made the change; nothing is committed yet.

| # | Status | Detail |
|---|---|---|
| 1 | **Fixed** | `fetchImageInlineData` now goes through `safeFetch` with a timeout signal, an `image/*` content-type check, and a 20 MB cap on both declared and actual size. The engine's private, weaker URL guard (no CGNAT range, no `::`) is deleted; `assertPublicHttpUrl` delegates to the shared module, so scrape and vision use one guard. The vision action rejects private/internal image URLs with a 400 before either provider sees them. Tests: `safe-fetch.spec.ts` (31 cases), `ai-client-image.spec.ts` (5, including "plain fetch throws if ever reached"). |
| 2 | **Fixed (other session)** | `personas_profile_migration.sql` added to `build-bootstrap.mjs` ORDER; `client_bootstrap.sql` regenerated (12 mentions). The "every migration is listed somewhere" spec is not written yet. |
| 3 | **Fixed (other session)** | Spec assertion scoped to "no `generation_events` query"; seat-cap lookup allowed. Suite green. |
| 4 | **Fixed** | Both write paths now call `serializePersonaProfile` (config route: serialize-then-merge; create route: serialize at birth). The gate itself is now **lossless for off-list strategy values** — a typed or legacy archetype is kept verbatim, matching values still snap to canonical spelling; the old behaviour blanked it, which was silent data loss on the next ordinary save. Persona page archetype/focus selects gained the same off-list guard the niche select had. Wizard archetype/focus inputs are now selects with the guard. Spec updated with the rationale. |
| 5 | **Correction + partly fixed (other session)** | The sweep was wrong that no `.env.example` exists: the repo-root one exists (20 vars). The other session is extending it. At last check 25 code-referenced vars were still absent (`UGC_*` generation knobs, `PUBLISH_ENFORCE_ACTIVE_HOURS`, `GEMINI_MODEL`, `FFMPEG_PATH`, the two interval vars). The drift test is not written; write it once their edit lands, or it will be red on arrival. |
| 6 | **Fixed** | Comments corrected in the store (header + `profileToMarketString`), `types.ts`, both agent routes. Left untouched on purpose: the header of `personas_profile_migration.sql`, because the other session is regenerating `client_bootstrap.sql` from it and a comment edit there would churn their output. Fix it in the P0.6 retirement migration. |
| 7 | **Fixed** | Vision prompt is built from `APPEARANCE_FIELDS` (all 14 keys, option lists inlined, "hairstyle is STYLE ONLY, length goes in hairLength"). Curated answers snap onto options; off-list answers kept verbatim; `coerceAppearance` unchanged. |
| 8 | **Fixed for Settings; persona page deferred** | Settings' five initializers use `untrack(() => …)` with a comment stating the seed-once intent and the condition under which an `$effect` re-seed becomes necessary. Settings warnings: 6 → 0. Total: 122 → 116. The persona page's 44 remain; it has a working manual resync and is the Persona Model v2 P0.4 rewrite target, so touching it twice would be waste. |
| 9 | **Partly fixed (other session)** | `.gitignore` now excludes `graphify-out/cache/last_query_stamp` and the tracked stamp is staged for deletion. The other 87 cache files are still tracked. Decide whether to ignore the whole `cache/` directory; not touched here to avoid colliding with that edit. |
| 10 | **Fixed** | `git mv` to `docs/archive/update_user_2026-06_one-off.sql` with a header stating it was applied once and is not a migration. No references existed. |
| 11 | **Fixed** | `prompt-regression.spec.ts`: 9 byte-level snapshots of `buildRichAgentContext` (now exported), `buildHeroPortraitPrompt`, `buildPortraitEditPrompt` across three real profile shapes, plus three invariants (creator name anchored, ethnicity in the subject, off-list hair colour verbatim, no "long long"). Every server side-effect module is mocked. This is the zero-regression net Persona Model v2 P0.7 depends on. |

**Verification after all changes:** `npm run test:unit` 291 passed / 0 failed (19 files; was 198/1 this morning), `npm run check` 0 errors / 116 warnings, per-file ESLint on every file touched shows only pre-existing errors (engine 52 → 52). `npm run lint` is red on `main` independently of this work (pre-existing `no-explicit-any` and unused-import errors across the codebase) — that is its own orphan and is not in this table.

**Not done, by design:** no commits. The other session has unrelated in-flight work (credits, flags, lifecycle, platform-admin, signup hardening) in the same tree, and a commit from here would sweep in half of it.

## Status — reassessed 2026-09-07

`main` moved to `4f2bb07` (eight billing commits). Suite: **418 passed / 29 files**. Typecheck: 0 errors / 116 warnings.

| # | 09-07 status |
|---|---|
| 1, 4, 6, 7, 10, 11 | Fixed on 09-05 by this session; **still uncommitted** in the working tree alongside the other session's changes. Verified at the browser/HTTP surface on 09-05 (PASS). |
| 2 | Fixed and **committed**; plus `migrations-coverage.spec.ts` now fails when any `.sql` is neither in `migrations.json` nor in `migrations-excluded.json` with a reason. `migrations.json` is now the single ORDER, with a checksum ledger (`000_schema_migrations.sql`) and `deploy.ps1` aborting on pending migrations. The follow-up spec suggested in the table is therefore done. |
| 3 | Fixed; spec change still uncommitted. |
| 5 | **Done by the other session:** root `.env.example` extended (54 lines) and `env-docs.spec.ts` fails on any undocumented `env.X` read. The 09-05 table's "no `.env.example`" was wrong (the root one existed); corrected. |
| 8 | Settings fixed (uncommitted). Persona page's 44 still deferred to Persona Model v2 P0.4. |
| 9 | Only the stamp is ignored; 87 cache files remain tracked. Still open. |
| 10 | Archived file also recorded in `migrations-excluded.json` with a reason, so it cannot quietly return to `supabase/`. |
| — | New since 09-05, not in the table: pre-commit hook rejects non-portable filenames (the U+F03A temp-path file incident); `eslint.config.js` scopes out `archive/`; `rate-limit.ts` throttles Admin-PIN guessing on `/signup`; `signup.spec.ts` added. |

**Open:** #9 (graphify cache), persona-page stale-state, `npm run lint` red on `main` from pre-existing `no-explicit-any` (the other session's eslint config change may have moved this; re-measure before claiming).

## Landed — 2026-09-07, commit `4ad3521` on `main`, verified in production

Stream A (items 1, 3, 4, 6, 7, 8-Settings, 10, 11) was rebuilt in a clean worktree on top of `1012f3b`, gated (unit 400/400, typecheck 0 errors), fast-forwarded onto `main`, built on the panel, and proven on the live host with the new `scripts/smoke-ssrf.mjs` (build `1788804890975`):

```
PASS  cloud metadata endpoint (169.254.169.254) rejected  — HTTP 400 Image URL rejected: URL resolves to a private/internal address
PASS  localhost rejected                                   — HTTP 400 Image URL rejected: URL resolves to a disallowed host
PASS  RFC1918 address (10.0.0.5, PostgREST port) rejected  — HTTP 400 Image URL rejected: URL resolves to a private/internal address
PASS  IPv6 loopback ([::1], Postgres port) rejected        — HTTP 400 Image URL rejected: URL resolves to a private/internal address
PASS  non-http scheme (ftp://) rejected                    — HTTP 400 Image URL rejected: Only http/https URLs are allowed
PASS  public image passes the guard                        — HTTP 200 {"appearance":{"headwear":"none"}}
PASS  unauthenticated request is refused                   — HTTP 401
PASS  cleanup: throwaway user removed                      — delete HTTP 200 · lookup HTTP 404
12/12 checks passed against https://honeyx.monarchstack.com
```

One change beyond the 09-05 fixes went in with it: in `read_appearance_from_image` the URL guard now runs **before** the "no AI provider" gate, so the guard holds, and the probe can prove it, on a host with no provider key. The probe was run locally in both provider states (12/12 each) before the push.

### Rail-set adoption landed — 2026-09-07, commit `754a38f`, verified in production

The dead 09-05 session's unowned rail work (finding #13) was adopted through a gated worktree pass on top of `52e574e`: deploy gates layered on billing's step-0 (`lint:ci` ratchet at 1,120 warnings, prod audit, warning ceilings, preflight `--warn-only`), pre-commit filename guard, eslint config, env-docs + migrations-coverage + signup specs, dependency bumps (`npm audit --omit=dev` 2 high → 0), signup hardening ported onto `throttle.ts`, ~20 lint edits, `graphify-out/cache/` ignored and 88 files untracked (#9 closed). Not adopted: `rate-limit.ts` (superseded, deleted), the Settings prettier residue (pure formatting, discarded). Gates on the branch: unit 441/441, typecheck 0 errors, mechanical revert check clean.

Live proof on build `1788815901479` (`46a7cca`), one-off signup probe:

```
PASS  signup 200 returns { user: { id } } (welcome-guard contract)
PASS  user exists in GoTrue with email confirmed (service-role path)
PASS  duplicate email → 409 (hardened route)
PASS  cleanup: probe user removed  — delete HTTP 200 · lookup HTTP 404
```

The billing session's live smoke passed 23/23 through the same route with the welcome grant still firing. Observation, not a defect: registration on the host is open (no `ADMIN_PIN` configured); the route and the deploy preflight both support the PIN gate, and `--warn-only` comes off once `GOTRUE_DISABLE_SIGNUP` is flipped on the Supabase project.

### New orphan findings from the landing (not yet in the table)

| # | Problem | Evidence | Fix |
|---|---|---|---|
| 12 | **Migration checksum ledger is not line-ending normalised.** A fresh Windows checkout (`core.autocrlf=true`, `text=auto`) reports all 36 ORDER files as DRIFTED; the shared tree, whose files happen to be LF on disk, reports 0. Content is identical. | `node scripts/apply-migration.mjs --status --strict` in a new worktree → `36 drifted`; `git ls-files --eol supabase/000_schema_migrations.sql` → `i/lf w/crlf` | Hash the blob after normalising `\r\n` → `\n` (or hash `git hash-object` output) so the ledger is checkout-independent; add a spec that hashes a CRLF and an LF copy of one migration to the same value. |
| 13 | **`main` was committed against an unowned working tree.** `87ed887` imported `$lib/server/rate-limit`, a file that existed only as an untracked leftover of a session that no longer runs; the panel build failed until `1012f3b` replaced the import. The same unowned set (deploy.ps1 gates, pre-commit filename guard, eslint config, `.env.example`, dependency bumps, ~15 lint-edited files, preflight/ceiling scripts, coverage/env specs, `migrations-excluded.json`) is still dirty and ownerless as of 09-07. | `git status` after the index reset; all three live sessions disowned it in writing | Decided 09-07 (G6): once the billing session lands its pending batch, adopt the remainder through a gated worktree pass with a reviewed diff summary, then push. Until then no session commits any of it. |
| 14 | **`origin` points at a moved repository.** Every push prints `This repository moved. Please use the new location: https://github.com/hnyxuser3/personagendemo.git`; pushes still redirect. | push output 09-07 | `git remote set-url origin <new url>` once the owner confirms the move is intentional. |

### Finding 12 — proven and owned, 2026-09-08

It bit for real. `market_restore_migration.sql` was applied from a worktree that
checks out LF and recorded `ed669907`; the shared tree checks the same commit out
as CRLF and hashes it `ddd40700`, so `--status` called it DRIFTED and
`--status --strict` (deploy step 0, `npm run verify:money`) failed on a database
that was correct — verified independently: 0 rows still hold JSON in `market`,
all agents hold a market string, the column comment is present.

```
git ls-files --eol supabase/market_restore_migration.sql → i/lf  w/crlf
sha256 as-is (CRLF)      ddd40700     ← what a CRLF checkout computes
sha256 LF-normalised     ed669907     ← what an LF checkout computes = the git blob = the record
```

Mirror image, same cause: a fresh worktree of `main` reports **38 of 39 files
drifted** while the shared tree reports **1**. The checksum was over bytes, not
content, so a record was only valid for checkouts whose line endings matched the
applier's.

**Fix (approved 2026-09-08):** normalise `\r\n` → `\n` (and strip a BOM) before
hashing, then re-stamp the legacy rows once. The re-stamp must rewrite a row
**only when the recorded checksum equals the raw hash of one of the two
line-ending renderings of the file now on disk** — that is proof the bytes differ
by nothing but `\r`, so a genuine edit can never be laundered through it.
Comparing against a single rendering is not enough: it silently fails from any
checkout whose line endings differ from the original applier's, which is exactly
the population of rows that needs repair.

**Owner:** the billing session (`personagendemo-12`) owns `apply-migration.mjs`
and is implementing it there, with a dry-run list reviewed before the ~38-row
ledger write. Regression test to ship with it: the same content as CRLF and as LF
must hash equal, and a genuinely edited file must still be refused.

**CLOSED 2026-09-08 by `42b531a`** ("the ledger checksum is a content hash, not a
byte hash"). Verified from two checkouts of that same commit, which is the
property that was broken:

```
shared tree   supabase/market_restore_migration.sql  w/crlf → 40 in ORDER · 0 pending · 0 drifted (exit 0)
worktree      supabase/market_restore_migration.sql  w/lf   → 40 in ORDER · 0 pending · 0 drifted (exit 0)
```

Before the fix the same two commands disagreed 1 vs 38. `deploy.ps1` step 0 and
`npm run verify:money` pass again from either tree.

---

## Finding 15 — a migration can reach production from a file nobody has committed

**New, 2026-09-08. Not yet closed.** Twice today a migration was applied to the
production database from a working-tree file that was untracked at the time:
`market_restore_migration.sql` (mine, 14:19) and
`model_registry_platform_migration.sql` (the models session, 16:08 — 347 rows
backfilled, RLS rewritten, `user_id` made nullable). Both were committed
afterwards (`5f2aa33`, `d4c9bfb`), so nothing is currently unreproducible, and
the live app was checked and is unaffected: the deployed build still filters the
registry by `user_id`, its 375 user-owned rows are intact, and the unique index
its upsert targets (`model_registry_user_id_model_id_key`) still exists beside
the new `model_registry_owner_model_key`.

That both attempts landed safely is luck, not a control. In the window between
apply and commit the only copy of a live schema change is one file on one
machine, and this is the second time in four days that production state has been
written by code that was not on `main` (finding #13 was the first, and it broke a
build).

**Gate to add — prevention at the point of the hazard, not detection after it.**
`apply-migration.mjs` should refuse to apply a file that is untracked or modified
relative to `HEAD`, with an explicit `--allow-uncommitted` escape for a genuine
emergency that then prints a loud reminder to commit. Cheap (one `git status
--porcelain -- <file>` per apply), impossible to forget, and it cannot break a
correct workflow because the correct workflow commits first. `apply-migration.mjs`
is owned by `personagendemo-12`; proposed to them 2026-09-08.

**Secondary, same family:** the ledger row is written before the code that needs
the schema reaches the host, so production briefly runs old code against new
schema. That is survivable when a migration is additive (both of today's were,
and both were verified so) and dangerous when it is not. Worth stating as a rule:
**additive migrations may lead the deploy; destructive ones must follow it.**
| 9 | (update) `.gitignore` edit is inside the unowned set above, so the `graphify-out/cache/` line and the `git rm -r --cached` of the 87 tracked cache files are folded into the same adoption pass. | — | — |

## Suggested order

1 (security, S) → 3 (green the suite, XS) → 2 (bootstrap, S) → 6 + 9 + 10 (hygiene, XS each, one PR) → 5 (env docs, S) → 4 + 7 (persona write path + vision, S) → 11 (prompt snapshots, S) → 8 (stale state triage, M).
