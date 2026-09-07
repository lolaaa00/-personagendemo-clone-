# PersonaGen — Persona Model v2: Best-Practice Assessment & Durable Implementation Plan

**Date:** 2026-09-05
**Purpose:** turn the lessons from personagen.dev's synthetic-persona contract into a durable upgrade of how *our* platform models, generates, stores, and consumes a creator persona — so every script, portrait, voice pick, bio, and autopilot draft is produced from one coherent, reproducible, structured identity instead of a prose blob plus fourteen loose strings.
**Companion docs:** [persona-model-v2-action-plan.md](persona-model-v2-action-plan.md) (task-level execution of this plan, with gates and rollback) · [persona-model-v2-ux-and-rollout.md](persona-model-v2-ux-and-rollout.md) (UX protection, per-field provenance, silent backfill, `PERSONA_BACKBONE` staged flag) · [market-gap-assessment.md](market-gap-assessment.md) (what to build and why, market view) · [persona-platform-readiness.md](persona-platform-readiness.md) (baseline health, `market` column history, safe-landing rules).
**Reference studied:** https://www.personagen.dev/docs — v3 grouped contract, 123 entries, 78 structured filters, US + UK routes, seeded deterministic generation, dependency-ordered sampling.

---

## 0. Executive verdict

personagen.dev and PersonaGen (ours) share a name and nothing else architecturally. Theirs is a **deterministic statistical sampler** of a fictional *person* (no LLM, seeded, <20 ms, census-informed, sampled in dependency order). Ours is an **LLM-first inventor** of a *creator* that we coerce onto a few option lists afterwards. Their persona is designed as an LLM conditioning payload ("pass one to a language model and it answers in character"). Ours is produced *by* an LLM and then consumed by other LLMs.

The single most valuable thing to take from them is not their 123 fields. It is the **generation order**:

> **Structured skeleton first (deterministic, seeded, dependency-ordered) → prose second (LLM, conditioned on the skeleton, forbidden from contradicting it).**

That flip fixes, by construction, every class of bug we currently patch with prompt rules: name/heritage/accent drift, "everyone is 25–34 athletic light-brown wavy hair", stray invented names, the audience-vs-creator age confusion, faces that drift across regenerations, and the fact that a persona today cannot be created at all without an AI key.

Everything else in this plan (field depth, Big Five, tokens-not-labels, metadata, audience cohorts, touchpoint contract) hangs off that flip.

**What we deliberately do not copy:** religion, politics, vote tendency, sexual orientation, health conditions, occupation codes, prevalence weights, source posture. A brand-owned creator must never carry those as generated attributes. At most they exist as a *never-discusses* guardrail list.

---

## 1. Where the persona lives today — the consumption map

Every place the profile is read, and what each reader actually uses. This is the surface the plan must keep working.

| Reader | File | Fields consumed today |
|---|---|---|
| Script / caption generation | [generate.ts:704-735](../../personagen-svelte/src/lib/server/content/generate.ts#L704-L735) `buildRichAgentContext` | `name`, `handle`, `niche`, `soul`, `archetype`, `contentFocus`, `contentAngle`, `ageRanges` (or `ageMin/ageMax`), `targetAvatar`, `psychProfile`, `skills` |
| Hero portrait | [generate.ts:2233-2266](../../personagen-svelte/src/lib/server/content/generate.ts#L2233-L2266) `buildHeroPortraitPrompt` | brief `demographics`, `soul` (600 chars), `appearance.ethnicity` (subject), `archetype`, `targetAvatar` (120 chars), `appearanceToPromptClause(appearance)`, voice gender |
| Portrait regenerate (edit) | `buildPortraitEditPrompt` | `appearance.ethnicity`, appearance clause |
| Voice pin | [voices.ts:139](../../personagen-svelte/src/lib/server/voices.ts#L139) `pickVoiceForProfile` | `voiceProfile.gender`, `voiceProfile.accent`, seed = agentId |
| Identity kit (bios/handles) | engine `generate_identity_kit` | `niche`, `soul`, `archetype`, `contentAngle`, `targetAvatar`, brief |
| Uniqueness fingerprint | engine `generate_persona_profile`, `generate_full_persona`, `suggest_directions` | `niche`, `archetype`, `contentFocus`, `contentAngle`, `targetAvatar`, `appearanceFingerprint(appearance)` |
| Vision read-back | engine `read_appearance_from_image` | writes 9 of the 14 appearance keys |
| Persona page | `personas/[agentId]/+page.svelte` `currentPersonaProfile()` | all 15 profile keys (hand-listed literal — the known data-loss shape, mitigated by `mergePersonaProfile`) |
| Save path | [agents/config/+server.ts:103-108](../../personagen-svelte/src/routes/api/agents/config/+server.ts#L103-L108) | `mergePersonaProfile(existing, patch)` → dual-write `personas_profile` JSONB + legacy `market` TEXT |
| External | `services/mcp-bridge` | **Verified 2026-09-05: reads neither `market` nor `personas_profile`** (selects id, name, handle, niche, status, supervisor fields only). The dual-write comments citing it are stale. |

**Storage:** `agents.personas_profile JSONB` (authoritative) with `agents.market TEXT` dual-written. 15 top-level keys, appearance is `Record<string,string>` with 14 known keys, values are display strings (`'25–34'` with an en-dash, `'Fair/Light'`).

**Observation that drives Phase 0:** three different concepts share one flat namespace — the *creator* (`gender`, `appearance`, `voiceProfile`, `displayName`), the *audience* (`ageRanges`, `ageMin/Max`, `targetAvatar`, `psychProfile`), and the *strategy* (`archetype`, `contentFocus`, `contentAngle`). The code comments already warn that `ageRanges` is the audience's age and `appearance.personaAge` is the creator's. That ambiguity is the root of several past bugs and it blocks any deepening of either entity.

---

## 2. Best practices extracted from personagen.dev — and what each one buys us

| # | Practice (theirs) | Our current state | What adopting it buys |
|---|---|---|---|
| P1 | **Skeleton before prose.** Fields are sampled in dependency order; the LLM never invents structure. | LLM invents everything; `coerceToOption` snaps afterwards; prompt rules like "Jenny Tran → Vietnamese" enforce coherence. | Coherence by construction. No stray names. Persona creation works with **zero AI keys** (skeleton + templated description is already a usable persona). |
| P2 | **Deterministic seed.** Same seed → same persona, every time. | Every regenerate is a new random person. Voice pin uses agentId as a seed — the one place we already do this. | Reproducibility, per-field re-roll (`seed + fieldSalt`), golden-snapshot regression tests, "undo" that is actually a re-derivation. |
| P3 | **Versioned contract + metadata block.** `metadata.version`, `generator_profile`, `seed`, `generated_at`. | No schema version, no provenance. `PERSONA_PROFILE_KEYS` is the only contract. | Safe evolution: readers upgrade v1→v2 lazily; we can tell which generator produced a persona; matches our media *generation-truth contract*. |
| P4 | **Machine tokens in storage, labels at render.** `75k_to_100k_usd` stored; `description.frame` carries `{key,label,value}`. | Display strings stored as values (`'25–34'`, en-dash-sensitive; `'Fair/Light'`). We have been bitten by the en-dash already. | Rename a label without a data migration. Stable keys for search/GIN index later. i18n-ready. |
| P5 | **Structured filters, not free text.** 78 filter fields, OR within a field, AND across fields, never override dependencies. | Brief → prose (`demographics`, `painPoints`) → LLM. `direction` is a 400-char free-text steer. | Brief becomes *constraints* on the sampler (market, age, gender mix, income band, life stage). Batch generation of N creators/viewers that all satisfy the brief. |
| P6 | **Explicit surface boundary.** Docs state which fields are filterable, which are display-only, which are "not public targeting surfaces". | Implicit — you have to read `generate.ts` to know what a field does. | A `PERSONA_TOUCHPOINTS` table + test: every contract field is either consumed by a named builder or marked display-only. Same discipline we applied to provider keys in Settings. |
| P7 | **Two entities: person vs description.** `data.*` is the structured truth; `description.short/frame` is derived for UI. | `soul` is both truth and description. | Creator card shows a fact strip; `soul` becomes derived-then-editable prose rather than the source of physical identity. |
| P8 | **Batch / cohort route.** `POST /personas` with `count` for a panel. | `generate_full_persona` caps at 3 creators. No audience panel at all. | Audience cohort (3–5 sampled viewers per brand) → message-testing judge before a draft reaches the review queue. This is their "message testing" use case applied to our pipeline. |
| P9 | **Depth where it changes behaviour.** Work, household, economic, behavior, psychology, decisioning, appearance sub-objects. | `niche` stands in for a job; nothing for household/location/income; 14 flat appearance strings; no trait scores. | Scripts get lived-in specificity (day job credibility, "my toddler", local weather); portraits stop drifting on facial hair/glasses; tone is controlled by Big Five numbers instead of adjectives. |
| P10 | **Synthetic, not real; scope stated.** Roadmap page lists what is *not* included. | — | Brand-safety denylist codified in the contract, not in a prompt. |

---

## 3. Target contract — `PersonaProfile` v2

Nested, versioned, token-valued. Every sub-object optional (partial profiles remain the normal case). Field names are the machine tokens; labels live in one registry.

```
PersonaProfileV2 {
  schemaVersion: 2
  meta {                         // P3
    seed            string       // canonical seed for the skeleton sampler
    registryVersion string       // REGISTRY_VERSION of the Trait Registry that produced the skeleton
    generator       'skeleton-v1' | 'llm-v1' | 'manual' | 'imported'
    generatorModel  string?      // provider/model that wrote the prose
    generatedAt     ISO
    upgradedFrom    1?           // set by the lazy v1→v2 upgrade
  }

  creator {                      // WHO THEY ARE (the person)  — new
    firstName, lastName, displayName
    gender          'female' | 'male'
    age             number       // exact; derived birthday for content hooks
    birthday        'MM-DD'
    heritage        token        // replaces appearance.ethnicity as source of truth
    market          'au' | 'us' | 'uk' | 'generic'   // reclaims the original meaning of agents.market
    location { region, city, geographicContext: 'urban'|'suburban'|'regional'|'rural', timezone }
    languages       token[]
    education       token
    work { domain, title, employmentStatus, workLocationMode, seniority }
    household { relationshipStatus, children: { count, ageBands[] }, pets: token[], housingType, livingState }
    lifestyle { activityLevel, transportMode, dietaryStyle?, socialPlatformsUsed[] }
    economic { incomeBand, priceFrame: 'budget'|'value'|'premium'|'luxury' }   // creator's own price lens
    bigFive { openness, conscientiousness, extraversion, agreeableness, neuroticism }  // 0–100
    traitLabels     token[]      // derived from bigFive, e.g. 'high_extraversion'
    neverDiscusses  token[]      // brand-safety denylist (politics, religion, health claims…) — P10
  }

  look {                         // HOW THEY APPEAR — deepened from `appearance`
    skinTone, bodyType, height { cm }, faceShape, browShape
    hair { color, grayCoverage, length, texture, style }        // texture ≠ style
    facialHair      token        // 'none' | 'stubble' | 'short_beard' | …   — biggest male drift source
    eyes { color, shape }
    eyewear         token        // 'none' | 'glasses' | 'sunglasses_often'  — second biggest drift source
    distinctiveFeatures string
    wardrobe, outfitColors, headwear, styling
    clothingSizes?  { top, bottom, shoe }                       // fashion UGC "true to size" content
    promptCues      string       // precomputed clause (= appearanceToPromptClause), like their avatar_prompt_cues
  }

  voice { gender, nationality, accent, pinnedVoice, voiceMatch }   // unchanged shape

  audience {                     // WHO THEY TALK TO — separated out
    ageRanges       token[]      // '25_34' not '25–34'
    genderMix       'female_skew' | 'male_skew' | 'mixed'
    lifeStage       token[]
    incomeBand      token
    decisioning {                // P9 — theirs, applied to the viewer
      priceSensitivity, purchaseChannel, brandLoyalty, promoResponsiveness,
      messageProcessingStyle: 'analytical'|'intuitive'|'social_proof'|'emotional',
      communicationPreference, digitalCapability
    }
    platforms       token[]
    targetAvatar    string       // prose, kept
    psychProfile    string       // prose, kept
    panel?          ViewerSkeleton[]   // Phase 3 cohort, 3–5 sampled viewers
  }

  strategy { niche, archetype, contentFocus, contentAngle }   // moved, unchanged values

  identityKit { bios, handleCandidates, confirmedHandles }    // unchanged

  description {                  // P7 — derived, regenerable without an LLM
    short           string       // templated from skeleton
    frame           { key, label, value }[]
  }
}
```

**Label registry:** `src/lib/persona-contract/labels.ts` — single `label(field, token)` lookup; the UI never stores what it displays.

**Compatibility rule:** `readPersonaProfile()` keeps its signature and *always returns v2*. A v1 blob is upgraded in memory by a pure `upgradeV1toV2()` (ageRanges → audience.ageRanges with en-dash→underscore; appearance.* → look.*; appearance.ethnicity → creator.heritage; personaAge bucket → creator.age midpoint; voiceProfile → voice; bios/handles → identityKit; archetype/contentFocus/contentAngle → strategy). Nothing is rewritten on disk until the next save. Unknown keys are carried through, as today.

---

## 4. The generator flip — skeleton sampler

New module `src/lib/persona-contract/sampler.ts`. **Pure, synchronous, seeded, no I/O, no LLM.**

```
samplePersonaSkeleton(seed: string, constraints: SkeletonConstraints): CreatorSkeleton
sampleViewerSkeleton (seed: string, constraints: AudienceConstraints): ViewerSkeleton
```

**Sampling order (dependencies flow downward, like theirs):**

1. `market` (from brief or constraint; default `'au'` — restoring the original meaning of the `market` column default)
2. `location.region → city → geographicContext → timezone` (per-market tables)
3. `gender` (constraint or coin)
4. `age` (constraint range, else niche-weighted prior — Gaming skews young, Finance older)
5. `heritage` (per-market distribution) → **name** (per-heritage first/last name tables, gender-aware) → `languages` → `voice.nationality/accent`
6. `education` → `work.domain` (niche-compatible list) → `work.title` → `seniority` (age-gated) → `employmentStatus`, `workLocationMode`
7. `economic.incomeBand` (education × seniority × market) → `priceFrame`
8. `household` (age-gated: children only ≥ 24, ageBands consistent with parent age; housing tenure vs age/income)
9. `lifestyle` (niche-weighted: Fitness → high activity; Pets → pets present)
10. `bigFive` (five Gaussian draws, archetype nudges: Entertainer ↑extraversion, Expert ↑conscientiousness) → `traitLabels`
11. `look` (heritage-conditioned skin/hair/eye priors; age-conditioned grayCoverage; gender-conditioned facialHair; ~15 % eyewear)
12. `description.short` + `frame` (templated)

**Constraints** are the brief mapped to structured filters (P5): market, age range, gender, income band, life stage, plus the user's `direction` string which still goes to the LLM step only. Filters never override dependencies (a 22-year-old cannot be sampled as a senior manager with three teenagers).

**Name handling — the one place we differ from them:** users name creators. If a name is supplied, the sampler runs `inferGenderFromName` + a heritage lookup and *conditions* on it (name is an input constraint, not an output). If no name is supplied, the sampler generates one from the heritage table. Either way the name and the heritage agree because one is derived from the other.

**Then the LLM step** (`generate_persona_profile` / `generate_full_persona` rewritten):

- Input: the skeleton as JSON + brand brief + taken-fingerprints + direction.
- Output: prose only — `soul`, `strategy.contentAngle`, `audience.targetAvatar`, `audience.psychProfile`, `look.wardrobe/outfitColors/styling/distinctiveFeatures`, and picks for `strategy.archetype/contentFocus`.
- Invariant enforced in code, not prompt: **any skeleton field present in the LLM response is discarded.** Test: feed a response that tries to change `creator.age` and `creator.heritage`; assert stored values equal the skeleton.

**Never-brick:** if no AI provider is configured, persona creation still succeeds with skeleton + templated description and empty prose fields, exactly as an incomplete wizard does today. If the sampler has no table for a market, it falls back to `'generic'` tables. Kill switch `PERSONA_GENERATOR=v1` routes back to the current prompts (same pattern as `UGC_CARD_RENDERER`).

**Data source — the local Trait Registry (decided 2026-09-05: no external adapter, ever).** `src/lib/persona-contract/registry/`. The registry is the single source of every sampled value: regions and cities, heritage distributions, name lists, education levels, occupations with niche affinities and age gates, income bands, housing, pets, dietary styles, look priors. It is:

- **In-repo and versioned.** `REGISTRY_VERSION` is a semver constant bumped on any weight or entry change; every generated profile records `meta.registryVersion`, so a persona can always say which tables produced it. Snapshot tests pin sampler output for fixed seeds, so a registry edit is a reviewed, deliberate change.
- **Per-market with a generic fallback.** `registry.for(market)` returns `au`, `us`, `uk`, or `generic` tables; a missing market or a missing table falls back to `generic` and never throws (the same never-brick posture as the model registry's static fallback).
- **Honest about what it is.** Header comment: "Curated plausibility weights, NOT census statistics." Weights are tuned to produce coherent, diverse creators, not to reproduce population baselines.
- **Extensible without touching the sampler.** Each table is `{ entries: [{ token, label, weight, gates? }] }` with a shared `Gate` shape (`minAge`, `maxAge`, `gender`, `niches`, `incomeBands`, `marketOnly`). The sampler only ever calls `registry.pick(table, rng, context)` which applies gates then weights. Adding a market is adding a directory; adding a trait is adding a table plus a token list plus a touchpoint entry.
- **Optionally overlaid from the database later.** Following the `model_registry` precedent (in-DB rows overlay the static list, static list is the never-brick fallback), a `persona_registry` table can carry per-account additions such as a client's real city list or house-style names. That is a later phase and is not required for any part of this plan.

---

## 5. Phased plan

Each phase ships independently, behind the kill switch where behaviour changes, and leaves the suite green. Order is chosen so that the earliest phases are pure data-model work with zero user-visible change, and the riskiest (prompt changes) come only once the invariants are tested.

### Phase 0 — Contract, metadata, lazy upgrade *(enabler; no behaviour change)*

- Add `src/lib/persona-contract/` with `schema.ts` (types), `tokens.ts` (enums as `as const` token lists), `labels.ts`, `upgrade.ts`.
- Extend `persona-profile-store.ts`: `PERSONA_PROFILE_KEYS` gains the v2 sub-object keys; `readPersonaProfile()` returns v2 (upgrading v1 in memory); `serializePersonaProfile()` normalises v2 and still accepts v1 patches (upgrades them first); `mergePersonaProfile()` merges *per sub-object* (a patch to `identityKit` cannot touch `look`).
- `meta` written on every save: `schemaVersion: 2`, `generator: 'manual'` when the user edited, `generatedAt`.
- Persona page `currentPersonaProfile()` replaced by a typed builder that reads/writes sub-objects — the last hand-written literal goes away.
- `services/mcp-bridge`: confirm it reads only top-level keys it knows; v2 nesting is additive so the `market` dual-write stays valid. Retire `market` only after this is verified (separate migration, as the readiness doc already prescribes).

**Gates:** `persona-profile-store.spec.ts` gains golden v1→v2 upgrade fixtures (three real production shapes: pre-bucket ageMin/Max only, full v1, appearance-with-legacy-combined-hairstyle). Round-trip property: `serialize(upgrade(v1)) → merge → read` loses nothing. `npm run check` clean.

### Phase 1 — Skeleton sampler + generator flip *(the core)*

- `sampler.ts` + tables for `au`, `us`, `uk`, `generic`.
- `PERSONA_GENERATOR=v2` path in `generate_persona_profile` and `generate_full_persona`: skeleton → LLM prose → invariant filter → store.
- Brief → constraints mapper (`briefToConstraints(brief)`): parses the existing prose `demographics` once with a tiny extraction prompt *or* reads structured brief fields when present; result cached on the brief row.
- Per-field re-roll: `spin_field` gets a deterministic sibling `reroll_skeleton_field(agentId, fieldPath)` that re-samples one field with `seed + ':' + fieldPath + ':' + n`, re-running only the dependents below it.

**Gates:** sampler determinism test (same seed, same output, 1,000 seeds); dependency invariants (children age < parent age − 16; seniority gated by age; heritage tables produce a name whose `inferGenderFromName` matches sampled gender); distribution sanity (over 1,000 seeds no single age bucket > 40 %, no single heritage > 45 % — this is the "not everyone is 25–34" guarantee, asserted); LLM-cannot-override invariant; no-AI-key creation succeeds.

### Phase 2 — Look v2 and portrait consistency

- Extend `look` with `facialHair`, `eyewear`, `faceShape`, `browShape`, `hair.texture`, `hair.grayCoverage`, `height`, `clothingSizes`.
- `appearanceToPromptClause` → `lookToPromptClause` emits the new fields; `look.promptCues` cached on save.
- `read_appearance_from_image` prompt extended to fill the new tokens from the pinned face, so an uploaded reference photo populates the structured look instead of nine free strings.
- Portrait edit prompt asserts `facialHair` and `eyewear` explicitly (these are the two attributes the image models most often drop between regenerations).

**Gates:** prompt-builder snapshot tests for hero + edit prompts against a fixed v2 profile; storage contract test that off-list legacy strings (`'honey blonde'`) survive verbatim (existing rule, re-asserted).

### Phase 3 — Audience v2 and the viewer panel

- `audience.decisioning` fields; brief → audience constraints; `sampleViewerSkeleton`.
- `audience.panel`: 3–5 viewers sampled per brand brief, stored on the profile, shown on the persona page as "Who she's talking to".
- Message-testing judge: optional step in `generate.ts` after caption/script generation — one cheap LLM call scoring the draft against each panel viewer (`messageProcessingStyle`, `priceSensitivity`, `promoResponsiveness`) and returning a 0–100 fit + one-line objection. Stored on the post as `fit_score` + `fit_notes`; surfaced on the review-queue card. Budget-gated like every other paid step.

**Gates:** panel determinism; judge is skippable by flag and by budget; review-queue card renders without the fields (older posts).

### Phase 4 — Consumer wiring + touchpoint contract

- `buildRichAgentContext` gains creator backbone lines (location + local flavour, day job as credibility, household facts allowed in content, Big Five → concrete tone instructions such as "extraversion 78: open with direct address, short sentences, high energy").
- Identity kit prompt gets location + occupation for bios.
- Voice picker gets an age band hint when the catalog carries voice ages.
- `PERSONA_TOUCHPOINTS` table: `fieldPath → [consumer]` or `'display-only'` or `'never-emit'` (the denylist). Test: every leaf in the v2 contract appears exactly once. This is the durability artefact — a new field cannot be added without declaring who reads it.

**Gates:** golden prompt snapshots for script, portrait, identity kit; touchpoint completeness test.

### Phase 5 — UI

- Persona Profile section regrouped into Creator · Look · Voice · Audience · Strategy · Identity Kit, each a collapsible card in the existing accordion style (as Settings provider keys already do).
- Fact strip from `description.frame` at the top of the persona card and in the personas rail.
- Per-field re-roll button (deterministic) next to sampled fields; "Regenerate prose" separate from "Re-roll person".
- Token → label everywhere via `labels.ts`; the en-dash chip keys become a rendering detail.

**Gates:** Playwright smoke: create persona with no AI key → card shows fact strip; edit one look field → save → reload → intact; regenerate prose → skeleton fields unchanged.

---

## 6. Durability rules (apply to every phase)

1. **Skeleton fields are immutable to the LLM.** Enforced by a filter in code and a test. Prompts may *describe* the rule but never *rely* on it.
2. **Tokens in storage, labels in one registry.** No display string is ever a storage value again. The `'25–34'` en-dash incident is the reference case.
3. **Every profile write carries `meta`.** Unknown generator → `'manual'`. No silent provenance.
4. **Upgrades are pure and lazy.** `upgradeV1toV2` never touches the database; persistence happens on the next ordinary save through `mergePersonaProfile`. This is the same lossless dual-read posture that landed the JSONB column safely.
5. **Sampler is pure, seeded, registry-driven.** Every value comes from the local Trait Registry; there is no network call anywhere in persona sampling. Snapshot tests pin outputs for fixed seeds, `REGISTRY_VERSION` is bumped on any change, and `meta.registryVersion` records which tables produced each persona.
6. **Never-brick.** No AI key → skeleton persona. No market table → generic table. New column? None needed (JSONB). Kill switch routes to v1 prompts — since 2026-09-07 every flag here follows `flags.ts` (env → Admin Console `platform_settings` → default), so the switch is a console flip with the env var as emergency override. Every LLM step is metered through the credit gate (`credits.ts`) as well as the budget gate; an unmetered path is a free path under `credits_mode=enforce`.
7. **Denylist is data, not prose.** `creator.neverDiscusses` and the `'never-emit'` touchpoint class are the only place brand-safety exclusions live.
8. **One consumer map.** A field that no builder reads and that is not marked display-only fails the touchpoint test.
9. **External consumer safety.** `services/mcp-bridge` is verified to never read `market` or `personas_profile`, so `market` retirement is unblocked. It is still its own additive migration (action plan P0.6) and the read-fallback stays until every database, including the client EasyPanel one, has run it.
10. **Green suite before each phase.** Same rule as the readiness doc's Phase 0; `npm run test:unit && npm run check` is the gate, not a suggestion.

---

## 7. What this strengthens in the product (the value case)

- **Content quality:** scripts stop sounding like "a UGC creator" and start sounding like *a 34-year-old Brisbane physio with a toddler and a dry sense of humour*, consistently, for hundreds of posts — because the facts are fixed and the tone is numerically specified.
- **Visual consistency:** the two biggest regeneration drift sources (facial hair, glasses) become explicit tokens the portrait prompts assert every time.
- **Diversity by construction:** a five-creator account spans ages, heritages, jobs, and households because the sampler distributes them, not because a prompt begged for "unique".
- **Zero-key onboarding:** a persona exists, with a portrait-ready look and a fact strip, before the user has pasted a single provider key.
- **Message testing:** the review queue shows how a draft lands with the brand's actual viewer types before anyone approves it. No competitor in the gap assessment does this.
- **Reproducibility and trust:** seed + generator + timestamp on every persona; "re-roll her job" is a deterministic, explainable action; snapshot tests make persona generation regression-testable for the first time.

---

## 8. Effort and sequencing

| Phase | Scope | Estimate | Risk |
|---|---|---|---|
| 0 | contract, upgrade, store, page builder | 2–3 days | low — no behaviour change |
| 1 | sampler, tables, generator flip, constraints | 4–6 days | medium — new prompts behind flag |
| 2 | look v2, prompt clauses, vision read-back | 2 days | low |
| 3 | audience v2, panel, judge | 3–4 days | medium — new paid step, budget-gated |
| 4 | consumer wiring, touchpoint contract | 2 days | low |
| 5 | UI regroup, fact strip, re-roll | 3–4 days | low |

Phases 0 → 1 → 4 are the minimum that delivers the flip. 2, 3, 5 can follow in any order.

---

## 9. Open decisions (owner call, not blockers)

1. **Default market.** `agents.market` has defaulted to `'Australia'` since the schema was written. The sampler default follows it (`'au'`) unless the brand brief says otherwise. Confirm.
2. **Message-testing judge placement.** Pre-queue (every draft, small cost) vs on-demand button on the card (free until clicked). Recommendation: on-demand first, promote to automatic once the score proves useful.
3. ~~personagen.dev as a supplier.~~ **Decided 2026-09-05: no adapter.** All sampled values come from the local Trait Registry (§4). No runtime dependency on any third-party persona API.
