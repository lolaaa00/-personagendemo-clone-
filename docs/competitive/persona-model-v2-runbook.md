# Persona Model v2 — Execution Runbook (from 2026-09-07)

**What this is:** the ordered, command-level sequence from the tree as it stands today to Phase 1 of Persona Model v2, with the gate that ends each step. It supersedes the "Suggested order" in the action plan for *sequencing*; task detail stays in [persona-model-v2-action-plan.md](persona-model-v2-action-plan.md), rails in its "Reassessment — 2026-09-07" section, UX rules in [persona-model-v2-ux-and-rollout.md](persona-model-v2-ux-and-rollout.md).

**The hazard this runbook is built around:** on 2026-09-07 three interactive sessions plus this one share `c:\Users\nexal\personagendemo`. The working tree is interleaved at the *hunk* level — `generate.ts`, `engine/+server.ts`, `settings/+page.svelte`, `generator/+page.svelte` and the persona page each carry hunks from two different streams. Every step below is shaped so that it cannot lose either stream's work.

---

## Step 0 — Session preflight (every session, every time, before any write)

```bash
git status --short                          # know what is dirty and whose it is
grep -rln '<<<<<<<' personagen-svelte/src   # must print nothing
ls .git/index.lock 2>/dev/null              # must not exist
ls personagen-svelte/node_modules/.bin/vite # must exist (a parallel npm install can tear it out)
```

Rules: never `git add -A` or `git add .`; never `git checkout -- <file>` / `git restore <file>` on a file you did not fully author this session (another stream's hunks live in it); never run `npm install` in the shared root while another session is mid-verification.

**Gate:** all four lines clean. If not, stop and report rather than proceed.

---

## Step 1 — Land the interleaved tree without losing either stream (one-time)

Two streams are uncommitted: (A) this session's orphan fixes, browser-verified PASS on 2026-09-05; (B) another session's lint cleanup, env docs, pre-commit guard, rate limiter, signup spec, and misc. They overlap in five files.

**1a. Ask, do not guess.** Message the live peers (`personagendemo-12`, `-90`, `-bd`) with one question: *"Are your uncommitted changes in personagen-svelte ready to commit as-is? If yes, commit them now with explicit paths (no `-A`); if no, say which files are still in flight."* Wait for the answer. A session that is idle for an hour with a dirty tree is treated as "abandoned in place": its hunks are kept, not reverted.

**1b. Commit in two passes, explicit paths only, whichever stream commits first.**

Stream A's exact path list (this session's, complete):

```
personagen-svelte/src/lib/server/safe-fetch.spec.ts
personagen-svelte/src/lib/server/ai-client.ts
personagen-svelte/src/lib/server/ai-client-image.spec.ts
personagen-svelte/src/lib/server/content/prompt-regression.spec.ts
personagen-svelte/src/lib/server/content/__snapshots__/
personagen-svelte/src/lib/persona-profile-store.ts
personagen-svelte/src/lib/persona-profile-store.spec.ts
personagen-svelte/src/lib/types.ts
personagen-svelte/src/routes/api/agents/+server.ts
personagen-svelte/src/routes/api/agents/config/+server.ts
personagen-svelte/src/routes/(portal)/personas/[agentId]/+page.svelte
personagen-svelte/.claude/skills/verify/SKILL.md
docs/archive/update_user_2026-06_one-off.sql   (+ the deletion of personagen-svelte/supabase/update_user.sql)
docs/audit/  docs/competitive/persona-model-v2-*.md
```

Five files are **shared** and must be committed whole by whichever pass goes second, after the first pass has landed: `generate.ts` (A: one hunk at ~L713 exporting `buildRichAgentContext`; B: three lint hunks), `engine/+server.ts` (A: guard delete + vision block; B: one hunk at ~L1424), `settings/+page.svelte` (A: three `untrack` hunks at L113–140; B: prettier re-wraps and lint), `generator/+page.svelte` (A: import + L641–676 selects; B: hunks at L95, L425, L820–890, L999), persona page (A: two option guards; B: three deletions).

Committing a shared file whole while the other stream is uncommitted is *correct*: it carries both streams' hunks, and the second pass finds the file already clean. The only wrong move is a per-file revert. Do not use `git apply --cached` hunk surgery on these; the prettier churn in Settings makes hunk selection unreviewable, and a mis-selected hunk silently drops one stream.

**1c. The badly-named file.** `git status` shows a staged deletion **and** an untracked re-creation of a file whose name is a Windows temp path (U+F03A). Stage nothing for it beyond the deletion already staged; the new pre-commit guard refuses it if it is ever added. `git restore --staged` is not needed. Leave the untracked copy for the owner to delete by inode if `git rm` refuses the name.

**Gate before each commit:**

```bash
cd personagen-svelte
npm run test:unit                       # 0 failed (418 today)
npm run check                           # 0 errors
node scripts/apply-migration.mjs --status --strict   # nothing pending or drifted
```

Commit message for stream A, verbatim:

```
fix(persona): wire SSRF guard on user URLs; lossless profile serialize on both write paths; vision prompt from APPEARANCE_FIELDS; wizard selects; Settings seed-once; prompt regression snapshots

Closes orphan audit items 1, 4, 6, 7, 8 (Settings), 10, 11 in docs/audit/orphan-problems-2026-09-05.md.
Browser-verified 2026-09-05 (docs/audit, "Status — end of 2026-09-05").
```

---

## Step 2 — Prove the security fix in production, then make the proof permanent

1. Deploy with `deploy.ps1` (it now aborts on pending migrations).
2. Prove it at the deployed host, authenticated as the smoke account, not locally:

   ```
   POST /api/engine?path=personagen-brand-brief
   {"action":"read_appearance_from_image","imageUrl":"http://169.254.169.254/latest/meta-data/"}
   → 400 {"error":"Image URL rejected: URL resolves to a private/internal address"}
   ```

3. Add that request as check 8 in `scripts/e2e-smoke.mjs` (it already creates and deletes a throwaway account against the live host). From then on every deploy re-proves the guard, and a regression is a red smoke, not a discovery.

**Gate:** the smoke run prints the 400 line against production. Paste it into the PR.

---

## Step 3 — Close the two orphans still open

- **Graphify cache (87 tracked files, churn + conflict source):** one commit, its own PR.

  ```bash
  printf '\n# graphify derived cache — regenerable, churns every query\ngraphify-out/cache/\n' >> .gitignore
  git rm -r --cached graphify-out/cache
  git add .gitignore && git commit -m "chore: stop tracking graphify-out/cache (derived, churns every query)"
  ```

  Keep `graphify-out/*.json` and the graph itself tracked. The existing stamp-only ignore line becomes redundant; leave it.

- **Persona page stale-state (44 warnings):** deliberately deferred to P0.4, which rewrites that page's profile state anyway. Do not touch it twice.

**Gate:** `git status` clean after a `/graphify` query.

---

## Step 4 — Isolate Persona Model v2 in its own worktree (the structural fix)

Every v2 phase runs in a dedicated worktree so no other session can interleave a hunk into it, and so its `node_modules` and dev-server port are private.

```bash
git worktree add ../wt-persona-v2 -b persona-v2/phase-0 main
cd ../wt-persona-v2/personagen-svelte
npm ci                                   # private node_modules
npx vite dev --port 5301 --strictPort    # private port; 5199/5237 belong to other sessions
```

Rules inside the worktree: same Step 0 preflight; one branch per phase (`persona-v2/phase-N`); squash-merge to `main` only from a green gate; `git worktree remove ../wt-persona-v2` at phase end. Never edit files in the shared root from this worktree's session.

**Gate:** `git worktree list` shows the worktree on its branch; `git -C ../wt-persona-v2 status` clean.

---

## Step 5 — Phase 0 in the worktree, task by task

Order and gates as in the action plan, with the 09-07 rails applied:

| Task | Do | Gate |
|---|---|---|
| P0.1 | `src/lib/persona-contract/{schema,tokens,labels,index}.ts` | `tokens.spec.ts` green; no runtime touched |
| P0.2 | `upgrade.ts` + `downgradeV2toV1` + three golden fixtures | idempotency + round-trip tests green |
| P0.3 | store reads/merges/serialises v2; per-sub-object merge | all existing store specs still green with v2 fixtures |
| P0.4 | persona page typed patch builder; this is also where the 44 stale-state warnings go | `npm run check` warning count for that file → 0 |
| P0.5 | routes typed; stale comments already fixed | integration test green |
| P0.6 | `market_restore_migration.sql` → **`supabase/migrations.json`** last entry → `apply-migration.mjs` on prod after the app deploy | `--status --strict` clean; `SELECT count(*) … market LIKE '{%' AND personas_profile IS NOT NULL` = 0 |
| P0.7 | provenance (`meta.fieldSources`) — the snapshot half already exists | provenance invariants green; `prompt-regression.spec.ts` byte-identical |

**Phase 0 exit:** a persona created before Phase 0 opens, edits, saves, regenerates identically; `meta.schemaVersion: 2` on next save; suite green; merged to `main`; deployed; the three demo creators opened in production and their observed state pasted into the PR.

---

## Step 6 — Phase 1 in a fresh worktree, with the rails

- Flags `PERSONA_GENERATOR` / `PERSONA_BACKBONE` go in **`flags.ts`** (env → Admin Console `platform_settings` → default) with `settings.ts` keys, Admin Console controls, and root `.env.example` lines (or `env-docs.spec.ts` fails).
- Every LLM call (P1.4 prose, P1.7 Tier 2) passes **`assertWithinBudget` and `assertCreditsAvailable`**, writes `generation_events`, debits via `debitForEvents`.
- `REGISTRY_VERSION` bump guard appended to `scripts/hooks/pre-commit` after the filename guard.
- Promotion `off → shadow → fill → on` is an Admin Console flip; the gate to `fill` is the shadow report in `docs/audit/` showing zero contradictions across production personas.

---

## Owner decisions still pending (block P1.1 tables, nothing earlier)

1. **Default sampler market.** Schema default is Australia. Confirm `'au'` or name another.
2. **Fit judge placement** (P3.3): on-demand button first, promote to automatic later — recommendation stands.

---

## What "done" means at every step

Tests passing is the entry condition, not the exit. A step is done when its gate line above has been observed and, for anything user-visible, the deployed host has been opened and the observed state recorded in the PR. "Committed" is not "live"; "live" is not "verified".
