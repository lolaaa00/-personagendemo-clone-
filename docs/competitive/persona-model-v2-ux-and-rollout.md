# Persona Model v2 — UX Protection, Silent Backfill, and Staged Rollout

**Date:** 2026-09-05
**Reads with:** [persona-model-v2-plan.md](persona-model-v2-plan.md) (contract and sampler) · [persona-model-v2-action-plan.md](persona-model-v2-action-plan.md) (tasks; this doc adds P0.7, P1.7, P1.8, P5.0 and the assessment gates)
**The constraint this doc exists for:** the persona model gets ~60 new structured fields, and the user must not feel any of them unless they go looking. No new required input. No new wizard step. No existing persona's scripts, portraits, or voice change until the backbone is deliberately switched on. Everything is filled on the back end; the front end shows one collapsed section and a one-line fact strip.

---

## 1. What the user sees today, and what must stay exactly the same

Verified against `personas/[agentId]/+page.svelte` and `generator/+page.svelte` on 2026-09-05.

| Surface | Today | Rule |
|---|---|---|
| Creation wizard | 3 steps: Identity (name, brief, optional direction) → Persona (soul, skills, archetype, focus, gender, heritage, avatar, psych, angle, pinned voice) → Review & Create | **Stays 3 steps.** Step 2 gains nothing visible except a collapsed "Life details" summary line under the pinned voice. |
| Persona page — Persona Profile section | open-by-default section with name, niche, status, target age chips, gender, archetype, focus, avatar, psych, angle, Appearance & Wardrobe (TraitPicker), "Generate for brand" button | **Unchanged.** Fact strip added to its header only. |
| Persona page — other sections | Platform Identity Kit, Character & Visuals, Automation, Spend & Pricing — all native `<details class="profile-section">`, collapsed by default | **One new section, same component, collapsed by default:** "Life details". |
| TraitPicker | chips per trait; "Best Fit" = leave it to the model; legacy free text survives as a custom chip | **Reused verbatim** for the new look tokens. "Best Fit" is relabelled nowhere; it already means "auto". |
| "Generate for brand" | one click fills profile + identity kit, then auto-saves | **Same click.** Under v2 it also fills the backbone. No second button. |
| Save | debounced, flush-on-navigate, merge-not-overwrite | **Unchanged.** Backbone rides the same patch through `mergePersonaProfile`. |

The non-negotiable: **a persona created last month, opened tomorrow after deploy, must render pixel-identical except for a collapsed row and a fact strip, and its next generated script must be byte-identical to what it would have been today.** Section 5 turns that sentence into a test.

---

## 2. The one visible addition: "Life details"

A native `<details class="profile-section">` placed between **Persona Profile** and **Platform Identity Kit**. Collapsed by default. Never auto-opens.

**Collapsed row (`<summary>`):** title + the fact strip as a muted single line, e.g.
`34 · Brisbane · Physiotherapist · Partnered, one toddler · Dog · Hybrid`
Rendered from `description.frame`, which the store derives on every save without an LLM. When the backbone is empty (pre-backfill persona), the row reads `Not filled yet — Generate for brand fills this` and nothing else.

**Expanded:** four sub-groups in the existing `fields-grid`, each a chip row in the TraitPicker style:

1. **Basics** — age, birthday, heritage, home city, languages
2. **Work** — job title, field, seniority, work mode
3. **Home** — relationship, children (count + ages), pets, housing
4. **Character** — the five Big Five traits as labelled sliders (0–100) with the derived label beside each (`Outgoing`, `Reserved`, …), plus `Never discusses` chips

Every chip carries a small provenance mark (§3): a faint `auto` tag when sampled, none when the user set it. Two controls per group: **↻ Re-roll** (deterministic, only touches `auto` fields) and **Reset to auto**. One control at the section foot: **Re-roll everything** with a confirm dialog that says the portrait will no longer match.

**No new inputs are required anywhere.** Every field renders "auto" when unset. A user who never opens the section never knows it exists, and loses nothing.

**Look v2 tokens** (facial hair, eyewear, face shape, brows, hair texture, gray coverage, height, sizes) do **not** get a new section. They join the existing Appearance & Wardrobe TraitPicker: facial hair and eyewear as core chips (they are the two drift sources), the rest under the existing collapsed "Advanced" group.

**Audience decisioning** (Phase 3) joins the existing Target Avatar / Psychology block as a single collapsed "Buying behaviour" row of chips. The viewer panel renders as four small read-only cards under it. Both collapsed by default.

**Dark/light:** all new surfaces use the existing tokens; the section reuses `.profile-section` styles untouched.

---

## 3. Provenance per field — the mechanism that makes silent filling safe

`meta.fieldSources: Record<leafPath, 'user' | 'sampled' | 'extracted' | 'derived'>`

| Source | Meaning | Re-roll may change it | Backfill may change it | Shown as |
|---|---|---|---|---|
| `user` | set or edited in the UI, or supplied in the wizard | never | never | plain chip |
| `sampled` | drawn by the registry sampler | yes | yes | `auto` tag |
| `extracted` | read from existing prose (soul) by the reconciliation step | never (it is the user's own text) | never | `from soul` tag |
| `derived` | computed from another field (age from bucket, timezone → market) | recomputed when its source changes | yes | `auto` tag |

Rules enforced in `serializePersonaProfile` and tested:
- A patch from the UI marks every changed leaf `user`.
- A sampler or backfill patch may only write leaves whose current source is absent, `sampled`, or `derived`.
- `Reset to auto` flips a leaf to `sampled` and re-draws it with the persona's seed.
- Provenance survives the v1→v2 upgrade: every leaf present in a v1 blob is marked `user` (it was visible and editable, so it is the user's).

This is what guarantees "Generate for brand" or a re-roll can never overwrite something the user typed, and what lets the same backfill run twice safely.

---

## 4. Silent backfill for existing personas — without contradicting what they already are

The danger is specific: an existing persona's `soul` may say *"Emirati fashion curator, 26, Dubai"*. A sampler that ignores that and draws *"Brisbane physiotherapist, 34"* would put two contradictory truths into every prompt. That is the UX-destroying failure, and it is prevented structurally.

**Tier 1 — no AI, runs on read, always safe.** Fills only leaves that are a pure function of data already stored, and marks them `derived`:
- `creator.gender` ← `gender`
- `creator.age` ← midpoint of `appearance.personaAge` bucket (else unset)
- `creator.heritage` ← `appearance.ethnicity` (verbatim text; token only when it matches a label)
- `creator.market` / `location.timezone` ← `agent_configs.timezone` (coarse: IANA zone → country; city stays unset)
- `strategy.*`, `audience.*`, `look.*` ← the v1 fields (already covered by the upgrade)
Nothing here can contradict prose because nothing here is new information.

**Tier 2 — AI available, runs once per persona, opt-in by flag or by "Generate for brand".** Two steps in strict order:
1. **Reconcile:** one JSON-mode extraction over `soul` + `contentAngle` + `targetAvatar`: *"For each of these fields, return the value ONLY if the text states or clearly implies it; otherwise null."* Every non-null answer is stored with source `extracted`. Test fixture: the Emirati/Dubai soul must yield `location.city: Dubai`, `work.domain: fashion`, `age: 26`, all `extracted`.
2. **Sample the remainder:** the registry sampler runs with seed `agentId` and constraints = every `user` + `extracted` + `derived` leaf. Dependency order means the sampled fields are downstream-consistent with the extracted ones (a Dubai fashion curator draws a UAE-plausible household, not a Queensland one; if the registry has no `ae` market it falls back to `generic`, never to `au`).

**Tier 2 never runs on page load.** It runs from the backfill script (§6) or when the user clicks "Generate for brand", so no page render ever waits on an LLM or spends money.

**Emission rule for consumers:** `buildRichAgentContext`, the portrait builders, and the identity kit emit only leaves that are **set**. An unset leaf contributes nothing. So a Tier-1-only persona's script prompt gains at most its age and heritage lines, and only once `PERSONA_BACKBONE=on` (§6). Before that, the prompt is byte-identical to today.

---

## 5. Robustly assessed — the verification ladder

Each rung is a named test or check in the action plan; none is optional.

| Rung | What it proves | Where |
|---|---|---|
| **Zero-regression snapshot** | For three real v1 fixtures (pre-bucket, full v1, legacy hairstyle), with `PERSONA_BACKBONE=off`, the script prompt, hero portrait prompt, edit prompt, and identity-kit prompt are **byte-identical** before and after every v2 PR. | `prompt-regression.spec.ts`, runs in `test:unit`; any diff fails CI |
| **Provenance invariants** | UI patch → `user`; sampler patch cannot touch `user`/`extracted`; upgrade marks v1 leaves `user`; reset flips to `sampled`. | `persona-profile-store.spec.ts` |
| **Reconciliation fixture** | The Dubai soul yields the extracted facts; the sampler then never contradicts them (city, domain, age unchanged after sampling; household plausible for the market). | `backfill.spec.ts` |
| **Tier-1 purity** | Tier 1 with no AI key changes zero visible fields and adds only `derived` leaves. Run against 200 synthetic v1 blobs. | `backfill.spec.ts` |
| **Sampler invariants + distribution** | as in action plan P1.2 | `sampler.spec.ts` |
| **Touchpoint completeness** | every leaf declared once with a consumer or `display` | `touchpoints.spec.ts` |
| **Page contract (Playwright)** | Open an existing persona: no new required fields, Life details collapsed, fact strip present or "Not filled yet"; edit an unrelated field, save, reload: backbone untouched; open Life details, re-roll Work, save: age/heritage/name unchanged. | `tests/e2e/persona-v2.spec.ts` |
| **Shadow-mode report on production data** | Before any user-visible change: run the backfill in `shadow` against prod, produce `docs/audit/persona-backfill-shadow-<date>.md` with per-persona: tier reached, fields extracted, fields sampled, **contradiction count** (extracted vs prose mismatches flagged by a second pass), and the exact prompt diff that `on` would introduce. Zero contradictions is the gate to `fill`. | `scripts/backfill-persona-v2.ts --mode=shadow` |
| **Deployed-URL proof** | After each phase deploys: open the production persona page for the three demo creators (Lexy, Chloe, Jenny), confirm the section is collapsed and the fact strip text, paste the observed strings into the PR. "Tests pass" is not "shipped". | PR template checklist |

---

## 6. Staged rollout — one flag, four positions

`PERSONA_BACKBONE=off | shadow | fill | on`. **Updated 2026-09-07:** implemented in `src/lib/server/flags.ts` with that module's precedence — env var if set → `platform_settings.persona_backbone` flipped from the Admin Console → default `off`. Promotion between positions is therefore an Admin Console flip with no redeploy; the env var is the host-level emergency override, not the normal control.

| Position | Backfill | Persisted | Emitted to prompts | UI |
|---|---|---|---|---|
| `off` (default at merge) | none | no | no | section hidden |
| `shadow` | Tier 1 on read + Tier 2 via script | **no** — computed, logged, diffed, discarded | no | section hidden |
| `fill` | Tier 1 on read (persisted on next save) + Tier 2 via script | yes | **no** | section visible, collapsed, fact strip live |
| `on` | as `fill` | yes | yes, set leaves only | as `fill` plus re-roll controls |

Promotion criteria:
- `off → shadow`: Phase 0 + P1.1–P1.2 merged; zero-regression snapshot green.
- `shadow → fill`: shadow report shows zero contradictions across all production personas and the prompt diff reads as pure addition.
- `fill → on`: the three demo creators reviewed by a human in production; one generated script per creator read side-by-side with a pre-v2 script and judged not worse.

Rollback at any position is setting the flag lower. Persisted backbone data is inert below `on`; it is never deleted by a rollback.

**New personas** created while the flag is `off` or `shadow` still use the v1 generator (`PERSONA_GENERATOR=v1`). `PERSONA_GENERATOR=v2` is enabled only at `fill` or later, so the skeleton-first path and the backbone display land together for new creators.

---

## 7. The backfill script

`scripts/backfill-persona-v2.ts --mode=shadow|fill --tier=1|2 --agent=<id>?` (same env-file pattern as `backfill:compress`)

- Iterates personas per user; Tier 2 needs the user's own AI key (respects `user_api_keys` and budget), skips and reports when absent.
- Idempotent: a persona whose `meta.backfill.tier` ≥ requested tier and `meta.registryVersion` current is skipped.
- Writes through `mergePersonaProfile` with a `sampled`/`extracted`/`derived` patch — it cannot touch `user` leaves by construction.
- Always emits the report in §5, even in `fill`, so every run leaves an audit trail in `docs/audit/`.
- Rate: sequential, one persona at a time, 300 ms spacing on Tier 2 calls; a failed extraction leaves the persona at Tier 1 and continues.

---

## 8. What "highly durable" means here, stated as checks

1. A persona with no backbone behaves exactly as today. *(zero-regression snapshot)*
2. No user-entered value is ever overwritten by automation. *(provenance invariants)*
3. Automation never introduces a fact that contradicts the persona's existing prose. *(reconciliation-first, shadow report, contradiction gate)*
4. Nothing user-visible changes until a human has read the production report and flipped a flag. *(staged flag, deployed-URL proof)*
5. Every rollback is a flag change and loses no data. *(inert-below-`on` rule)*
6. The section can be ignored forever with no cost. *(collapsed default, no required inputs, unset = contributes nothing)*
7. A re-roll can never change the face. *(re-roll touches `sampled` leaves below the chosen field only; look and identity leaves are above it in dependency order or `user`)*
