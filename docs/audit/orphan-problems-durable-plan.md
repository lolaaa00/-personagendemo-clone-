# Orphan Problems — Durable Implementation Plan

**Date:** 2026-09-05
**Companion:** [orphan-problems-2026-09-05.md](orphan-problems-2026-09-05.md) is the finding list (11 items, each verified against the tree). This document is the execution spine: in what order, with which guardrail, how it is verified, and how it fails safely. It also folds in three findings from a second sweep the same day that the finding list does not carry: the signup gate bypass (S1), the vulnerable production dependencies (S2), and the mechanism by which junk got committed (S3).

"Durable" here has one meaning: **every fix ships with the thing that would have caught it.** An orphan problem is one nobody owns. The only owner that survives staff and sessions is a gate that runs on every deploy. This repo has exactly three places a gate can live, and no CI: `deploy.ps1` (the only path to `main`), `personagen-svelte/scripts/hooks/pre-commit`, and `vitest --project=unit`. Every commit below puts its guardrail in one of those.

---

## 0. Invariants (each commit is checked against these)

1. **A fix without a regression check is not done.** The check is a unit spec, a deploy step, or a pre-commit rule. Prose comments are not checks; finding #6 is what a prose check decays into.
2. **Gates cannot be skipped silently.** `deploy.ps1 -skipTests` stays available for emergencies but prints a red banner and appends `[gates skipped]` to the commit message so the bypass is visible in `git log`.
3. **Infra changes get a runtime probe, not a memory note.** If the fix is a setting on a server (the Supabase auth flag), a script proves the setting is live and the deploy fails when it is not.
4. **Ratchets, not big-bangs, for large backlogs.** Lint errors (1,068) and stale-state warnings (63) are gated at their current count and the count may only go down. A zero-tolerance gate would be turned off within a week.
5. **One concern per commit.** Each commit is independently revertable. No commit mixes a rail change with a feature change.
6. **Never widen scope inside a fix.** Persona-model work (findings #4, #6, #7, #11) is owned by the [Persona Model v2 action plan](../competitive/persona-model-v2-action-plan.md); this plan only lands the pieces that are pure hygiene and hands the rest over by reference.

---

## 1. Verified state of the tree today

Already applied to the working tree during the second sweep, **uncommitted**, all checks green (svelte-check 0 errors, 199/199 unit tests, `npm audit --omit=dev` 0 vulnerabilities):

| Change | File(s) | Finding |
|---|---|---|
| Signup route creates users via the service role, timing-safe PIN compare, anon fallback when no service key | `personagen-svelte/src/routes/api/auth/signup/+server.ts` | S1 |
| personas_profile migration added to bootstrap ORDER; bootstrap regenerated (additive only) | `personagen-svelte/supabase/build-bootstrap.mjs`, `client_bootstrap.sql` | #2 |
| Budget spec asserts "no ledger read" instead of "no query" | `personagen-svelte/src/lib/server/budget.spec.ts` | #3 |
| undici 7.28.0 → 7.29.1, ws 8.20.1 → 8.21.3, protobufjs 7.6.2 → 7.6.6 | `personagen-svelte/package-lock.json` | S2 |
| ADMIN_PIN and 12 tuning knobs documented; false Composio note removed | `.env.example` | #5 (partial) |
| Stray 69KB scratchpad diff untracked from repo root; graphify query stamp untracked and ignored | index, `.gitignore` | #9 (partial), S3 |

Verified facts the plan relies on:

- The Supabase auth server at the prod host returns `disable_signup: false`, `mailer_autoconfirm: true` from `/auth/v1/settings`. The anon key is in the browser bundle. The PIN gate is therefore bypassable until that flag flips. (S1)
- `deploy.ps1` step 2 runs `git add -A` on the repo root. That is how a file named with a Windows temp path landed in the root of `main`. Any stray file in the working tree at deploy time is committed. (S3)
- `safeFetch` in `safe-fetch.ts` has zero call sites; `fetchImageInlineData` in `ai-client.ts` fetches a user-supplied URL with `fetchWithTimeout`. (#1)
- `build-bootstrap.mjs` has no export and writes on import; nothing can test its ORDER without regenerating the file. (#2)
- `npm run lint` fails with 1,068 errors: 789 `no-explicit-any`, 122 `svelte/require-each-key`, 67 `svelte/no-navigation-without-resolve`, 33 `no-unused-vars`, 20 `prefer-svelte-reactivity`, 15 `no-useless-assignment`, 10 unused svelte-ignore, 3 `prefer-const`, 2 `preserve-caught-error`. Lint is in `package.json` and in nothing else.
- `npm audit fix --omit=dev` prunes dev dependencies from `node_modules` (it did today; `npm install` restored them). Never run it with that flag again; run `npm audit fix` then `npm install`.
- The monetization plan's Phase −1 also edits `deploy.ps1` (a migration-status step 0). C1 below is written to compose with it: both add steps before the existing step 1; neither touches the other's step.

---

## 2. Execution sequence

Order is by blast radius of leaving it open, then by how much later work depends on it. Effort: XS under 1h, S half day, M 1–2 days.

### C0 · Land the working tree (XS)

**Change.** Review and commit the six changes in §1 as one commit, `fix(audit): land 2026-09-05 orphan fixes`. Delete the stray root file by hand first (its name contains U+F03A, which Git on Windows reads as a drive letter; `git rm` refuses it, and `git update-index --force-remove -z --stdin` is how it was untracked).

**Guardrail.** None of its own; C1–C4 add the guards for each item. This commit exists so the guards in later commits have a green baseline to protect.

**Verify.** `npm run check`, `npm run test:unit`, `npm audit --omit=dev` all clean. `git status` shows only the docs folders other sessions own.

**Rollback.** `git revert`. Nothing here is a schema change; the bootstrap edit only affects databases created after it.

---

### C1 · Rails: make the deploy path unable to repeat S3, S2, and invariant 2 (S)

**Change** to `deploy.ps1` and the pre-commit hook.

1. **Replace `git add -A` with a guarded add.** Before staging, list untracked files (`git ls-files --others --exclude-standard`). Abort with the list if any untracked path is at the repo root or outside `personagen-svelte/`, `services/`, `docs/`, `scripts/`, `.claude/`, `.agents/`. The developer either ignores it, moves it, or passes `-allowUntracked`. This is the exact failure that committed the scratchpad file.
2. **Non-portable filename check in pre-commit.** Reject any staged path containing a byte at or above 0x80, a `:`, a backslash, or longer than 200 bytes. Message names the file.
3. **Production audit gate.** New step before type-check: `npm audit --omit=dev --audit-level=high`; abort on failure. Moderate stays advisory (printed, not fatal) so a transitive moderate cannot block a hotfix.
4. **Visible bypass.** When `-skipTests` is set, print a red banner and append ` [gates skipped]` to `$m`. Same for a future `-skipLint`.
5. **Migration status step** belongs to the monetization plan's Phase −1; leave a comment marker `# step 0 reserved: migration status (see docs/monetization/durable-implementation-plan.md)` so the two edits do not collide.

**Guardrail.** This commit *is* a guardrail. Its own check: a dry-run mode `deploy.ps1 -dryRun` that runs steps 0–1 and prints what step 2 would stage, without committing or pushing. Run it once with a deliberately planted root file and confirm it aborts.

**Verify.** Dry run aborts on a planted `./junk.txt`; passes after removing it. A `-skipTests` dry run shows the suffix in the composed commit message.

**Rollback.** Revert the script; the hook is opt-in via `core.hooksPath` and reverts with it.

---

### C2 · SSRF: route user-supplied image URLs through the guard that already exists (S) — finding #1

**Change.**

1. `fetchImageInlineData` in `ai-client.ts` calls `safeFetch(url, {})` under the same timeout, not `fetchWithTimeout`. `safeFetch` already resolves DNS and rejects private, loopback, link-local and reserved ranges.
2. At the engine `read_appearance_from_image` action: require `https:`; require the host to be the app's own media/storage host or a small allowlist (`fal.media`, the Supabase storage host, the `/media` proxy host). Reject everything else with 400 before any fetch.
3. Add a 5 MB cap on the response body and a content-type check (`image/*`) in `fetchImageInlineData`; today a 200 MB response would be base64'd into memory.

**Guardrail.** Two specs, `src/lib/server/safe-fetch.spec.ts` and `src/lib/server/ai-client.spec.ts`:

- Pure: `isPrivateOrReservedIp` covers `10.`, `127.`, `169.254.`, `172.16–31.`, `192.168.`, `::1`, `fc00::/7`, `fe80::/10`, `0.0.0.0`. `resolvePublicIps` with a mocked resolver returning a private address throws.
- Usage: a source-level spec reads `ai-client.ts` and asserts the body of `fetchImageInlineData` references `safeFetch` and does not reference `fetchWithTimeout`. This is the check that fails when someone "simplifies" it back. Crude, but it is the check that was missing for the months the guard sat unused.

**Verify.** Manual: call the engine action with `http://127.0.0.1:8000/` → 400 before any network. With a public image URL → unchanged behaviour.

**Rollback.** Revert; the guard falls back to unused, which is today.

---

### C3 · Bootstrap and SQL-folder coverage: a migration can no longer be forgotten (S) — findings #2, #10

**Change.**

1. `build-bootstrap.mjs` exports `ORDER`, `FOLDED_INTO_APPLY_ALL`, and `EXCLUDED` (`[file, reason]`), and only writes the file when run as main (`import.meta.url === pathToFileURL(process.argv[1]).href`). The build function returns the SQL string.
2. Move `supabase/update_user.sql` (a one-off `auth.users` rewrite for a specific customer email) to `supabase/one-off/2026-06-09-rename-account.sql` with a header stating it must never be run against another project, or delete it. Either way it leaves the folder that the bootstrap scans.
3. New spec `src/lib/server/migrations-coverage.spec.ts`:
   - Every `supabase/*.sql` is exactly one of: in `ORDER`, in `FOLDED_INTO_APPLY_ALL`, in `EXCLUDED` with a non-empty reason, or the base `migration.sql`. Anything else fails with the filename.
   - `client_bootstrap.sql` on disk equals the string the builder returns. Fails when ORDER is edited without regenerating, and when a migration file is edited without regenerating.
   - The builder *output* contains no bare `ADD CONSTRAINT` outside a `DO $$ ... IF NOT EXISTS` wrapper and no `CREATE TABLE` without `IF NOT EXISTS`. The builder rewrites these, so the spec checks the output, not the inputs.

**Guardrail.** The spec. It is the first spec in the repo that reads the filesystem; `src/lib/server/` specs already run under the `unit` project with Node globals, so `readFileSync` works without config changes.

**Verify.** Delete the personas_profile line from ORDER → spec fails naming the file. Restore → green. Touch any migration file → spec fails until `node supabase/build-bootstrap.mjs` is rerun.

**Rollback.** Revert; the builder goes back to write-on-import.

---

### C4 · Environment documentation that cannot drift (S) — finding #5

**Change.**

1. `.env.example` at the repo root stays the single source. The finding list looked in `personagen-svelte/` and called it absent; it is at the root, and the Docker build context is `personagen-svelte/`, so add a one-line `personagen-svelte/.env.example` that points at `../.env.example`.
2. Every variable gets: required/optional, default, one-line effect. Today's edit did the 13 missing names; C4 finishes the format for the pre-existing ones.
3. New spec `src/lib/server/env-docs.spec.ts`: collect every `env.NAME`, `privateEnv.NAME`, `publicEnv.NAME`, `process.env.NAME` in `src/**/*.{ts,svelte}`; every name must appear at line start in `.env.example`, commented or not. Allowlist: `NODE_ENV`, `PORT`, `ORIGIN`, `BODY_SIZE_LIMIT` (adapter-node built-ins). The reverse direction is advisory only (printed): names documented but unread, because `services/` reads some of them.

**Guardrail.** The spec. Adding `env.NEW_KNOB` without a doc line fails the unit suite, which fails the deploy.

**Verify.** Add `env.FAKE_KNOB` to any server file → red with the name. Remove → green.

**Rollback.** Delete the spec; docs stay.

---

### C5 · Signup gate: close the bypass and prove it stays closed (S + infra) — S1

**Change.**

1. **Infra (not code):** set `GOTRUE_DISABLE_SIGNUP=true` on the Supabase auth service in EasyPanel for prod, and for the HoneyX client stack when it is bootstrapped. The route from C0 already creates users with the service role, so registration keeps working after the flip. Prod first, verify, then client.
2. **Probe:** `personagen-svelte/scripts/preflight-auth.mjs` reads `PUBLIC_SUPABASE_URL` and the anon key from `.env`, GETs `/auth/v1/settings`, and exits 1 with a plain message when `ADMIN_PIN` is set and `disable_signup` is `false`. Wire it into `deploy.ps1` as a step before type-check. Until the flip is done, run it with `-warnOnly`; after, remove the flag. That is the moment the fix becomes durable.
3. **Route spec** `src/routes/api/auth/signup/signup.spec.ts` with a mocked service client: wrong PIN → 400 and `createUser` never called; right PIN → `createUser` called with `email_confirm: true` then `signInWithPassword` on the cookie client; duplicate (status 422) → 409; no service key → falls back to `signUp`.
4. **Rate limit** PIN attempts: an in-memory per-IP bucket (10 per 15 min) in the route. Not durable across instances and does not need to be; it turns a free brute-force into a slow one until the platform-level limiter in the monetization plan lands.

**Guardrail.** The preflight step in the deploy path. A future Supabase re-provision that resets the flag fails the next deploy with the reason printed.

**Verify.** After the flip: a direct POST to `<supabase>/auth/v1/signup` with the anon key returns 422 "Signups not allowed"; the app's `/signup` with the PIN still creates a user and lands on `/dashboard`; preflight passes without `-warnOnly`.

**Rollback.** Flip the flag back; the route works either way. The probe then fails, which is correct.

---

### C6 · Lint resurrection by ratchet (M)

**Change.**

1. `eslint.config.js`: `@typescript-eslint/no-explicit-any` → `warn`; `svelte/no-navigation-without-resolve` → `warn` (67 sites, style-level); `svelte/prefer-svelte-reactivity` → `warn`. Everything else stays `error`.
2. Fix the remaining errors in one mechanical pass: 122 `require-each-key` (add `(item.id)` keys; where no id exists, the index with a comment), 33 `no-unused-vars`, 15 `no-useless-assignment`, 10 unused svelte-ignore, 3 `prefer-const`, 2 `preserve-caught-error`. About 185 edits, no behaviour change. `require-each-key` is the one class with real bug potential (list reorders re-using DOM state), which is why it stays an error.
3. Add `npm run lint` to `deploy.ps1` after type-check. Add `--max-warnings <current>` to the lint script, with the number checked in; lower it whenever a change reduces it. The number only goes down.

**Guardrail.** The deploy gate plus the checked-in warning ceiling.

**Verify.** `npm run lint` exits 0. Introduce one `{#each}` without a key → exits 1.

**Rollback.** Revert the config; the fixes are safe to keep.

---

### C7 · Hand-offs to the Persona Model v2 plan (XS here) — findings #4, #6, #7, #11

These are persona-model work and the v2 plan already has homes for them. This plan lands only the zero-risk part and records the hand-off so they are not orphaned twice.

- **#6 false comments** (the bridge does not read `market`): correct the five comments now, one commit. The bridge's `select` list is the evidence; quote it in the comment. P0.6 then retires the dual-write.
- **#4 serialize on both write paths** → P0.5 (save and create paths). Add to that item's acceptance: "config and create routes both call `serializePersonaProfile`; spec asserts an off-list archetype is coerced on write."
- **#7 vision read-back keys** → P0.7 alongside the prompt snapshot.
- **#11 prompt snapshot tests** → P0.7 explicitly; it is already "zero-regression prompt snapshot".

**Guardrail.** Each item is added to the referenced P0 heading's acceptance list in the v2 action plan, in the same commit that fixes the comments.

---

### C8 · Stale-state warnings by ratchet (M) — finding #8

**Change.**

1. Parse `svelte-check --output machine` in a small script `scripts/check-warnings-ceiling.mjs`; fail when the `state_referenced_locally` count exceeds the checked-in ceiling (63 today). Wire it after type-check in `deploy.ps1`.
2. Triage the 12 files. The persona page (44) has a hand-rolled resync and is correct; mark each intentional capture with `<!-- svelte-ignore state_referenced_locally -->` and a one-line reason so the count drops to the real cases. The other 11 files each get one of: wrap in `{#key data.<id>}`, move the seed into a `$derived`, or add a resync `$effect` keyed on the identity, whichever the page's edit pattern needs.
3. Lower the ceiling as each file lands.

**Guardrail.** The ceiling script in the deploy path.

**Verify.** Navigate persona A → B via the roster: every field re-seeds. Settings: submit, then browser back and forward: the form shows the saved values.

**Rollback.** Per file.

---

## 3. Failure modes this plan is designed around

| Failure | Where it is caught | What happens if the gate is bypassed |
|---|---|---|
| Stray file in working tree at deploy | C1 guarded add | Pre-commit filename rule still rejects the pathological names; ordinary junk gets committed and is visible in the deploy commit's diff |
| Migration added, bootstrap not regenerated | C3 spec | Fresh databases miss the column; the app's never-brick fallbacks keep running on the legacy column, same as today |
| New env knob, no doc | C4 spec | Knob works; the next deployer cannot find it, the pre-plan state |
| Supabase re-provisioned, signup flag reset | C5 preflight | PIN gate becomes decorative again; the route itself still works |
| Vulnerable prod dependency | C1 audit step | Ships; visible on the next `npm audit` |
| Lint or warning count creeps up | C6 / C8 ceiling | Ships; the number is checked in, so the creep is in the diff |
| `-skipTests` used | C1 banner + commit suffix | Visible in `git log` forever |

---

## 4. Order and sizing

| Commit | Effort | Depends on | Owner after landing |
|---|---|---|---|
| C0 land tree | XS | — | — |
| C1 rails | S | — | `deploy.ps1`, pre-commit |
| C2 SSRF | S | — | `safe-fetch.spec`, `ai-client.spec` |
| C3 bootstrap coverage | S | C0 | `migrations-coverage.spec` |
| C4 env docs | S | C0 | `env-docs.spec` |
| C5 signup gate | S + infra | C0, C1 | `preflight-auth.mjs` in deploy |
| C6 lint ratchet | M | C1 | deploy lint step + ceiling |
| C7 v2 hand-offs | XS | — | v2 action plan P0.5–P0.7 |
| C8 stale-state ratchet | M | C1 | deploy ceiling step |

C0 → C1 → C2 → C3 → C4 → C5 in a single sitting is about two days and closes every security and data-integrity item. C6–C8 are the ratchets and can trail by a week without anything regressing, because C1 already blocks the only path to `main`.

## 5. Things not to do

- Do not run `npm audit fix --omit=dev`; it prunes dev dependencies. Use `npm audit fix` followed by `npm install`.
- Do not add a CI system to get these gates; `deploy.ps1` is the only path to `main` and the gates belong where the push happens. If CI arrives later, it runs the same npm scripts.
- Do not delete `graphify-out/cache/ast/**` (88 files) without checking the graphify skill's cache contract; only the query stamp is pure churn and only it is ignored.
- Do not fold C2's URL allowlist into a broad "trusted hosts" env var. The list is three hosts; a knob is one more undocumented env name.
