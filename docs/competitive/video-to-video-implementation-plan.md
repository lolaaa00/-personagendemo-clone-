# Video-to-Video — Durable Upgrade Implementation Plan

**Date:** 2026-09-09
**Measured against:** `feat/composer-upgrade-and-ui-defects` @ `b6b4c27` **plus the uncommitted working tree** — which is where most of the news is.
**Companion docs:** [fannabe-viability-assessment-2026-09-09.md](fannabe-viability-assessment-2026-09-09.md) · [market-gap-assessment.md](market-gap-assessment.md) · [persona-model-v2-action-plan.md](persona-model-v2-action-plan.md)

**Status: BUILT, 2026-09-09.** This document began as a proposal and is now a
**record**. Everything below is preserved — including the parts reality
overtook — because the reasoning is why the decisions are defensible, and a plan
edited into agreement with its outcome teaches nothing. Read §0 through §7b as
*written on the morning of the 9th*, and **[§7c](#7c-what-actually-shipped--the-record) for what is in the tree.**
Section headings carry a status marker where one applies.

---

## 0. Executive summary — *as written, morning of 2026-09-09* ⏪ SUPERSEDED BY §7c

> The opening sentence was true when written and is false now: the pipeline
> exists. The paragraph is kept because the argument it makes — that this is a
> lateral move in spend, not a premium feature — is the argument that got it
> built, and it survived contact with a measured run.

We have **no video-to-video pipeline**. Every video path is image→video: `generateBrollVideo` sends `image_url` + `prompt`, `generateTalkingHead` sends `image_url` + `audio_url`, cinematic sends generated stills into a reference endpoint.

That was also true this morning. What changed between the first assessment pass and this one is that **three of the four engineering blockers were removed by work already sitting in the uncommitted tree**, built for entirely unrelated reasons. Video-to-video is now roughly 60% built by accident.

What remains is: video ingest, one billing generalization, and a policy decision that is not an engineering call.

---

## 1. Cross-reference — what the working tree already did for us ✅ ALL RESOLVED

> **Closed 2026-09-09.** The two rows still marked **Stands** below — video
> ingest and per-second billing — were both built the same day. Ingest is
> `POST /api/agent/[agentId]/source-clip` + `probeVideo`; billing is the
> `Billing` union in `models.ts`. The row that reads "Stands, and is now
> sharper" was the sharpest thing in this document and it aged into a changelog
> entry in about six hours. Legal was settled by the owner — see §7b.

| Blocker identified in the first pass | Status | Evidence |
|---|---|---|
| The `model_registry` CHECK constraint rejects any new `kind`, so v2v needs a migration | **Removed** | `RegistryKind` is now an explicit `REGISTRY_KINDS` list with `isRegistryKind()`; `effectiveOptions` / `effectiveResolve` fall through to the static catalog for catalog-only kinds. `talking_head` and `llm` shipped this week **with no migration**. |
| No way to express a new pipeline stage | **Removed** | `StepKind` gained `motion` and `mux`; `FormatEntry.request.format` gained `vo_broll` and `motion_card`; `formats.spec.ts` pins the legacy round-trip. |
| No host-capability gate — a format we cannot build would be sold and then fail after the money is spent | **Removed** | `FormatEntry.needsFfmpeg`, with the rule stated in-code: *"hidden where it cannot be built, rather than offered and failed after the money is spent."* |
| "Our narrative over someone else's footage" needs a new audio-mux layer | **Removed** | `muxVoiceover` / `buildVoiceoverArgs` shipped for the `vo-broll` format, including the `hasSourceAudio` case. |
| **No video ingest anywhere in the app** | **Stands** | The only upload path in the codebase is `generate-avatar`'s multipart `reference` — one image, 10MB. `listUserImages` is images-only. |
| **Per-second billing vs a per-call quote** | **Stands, and is now sharper** | `planPipeline` special-cases exactly one kind: `kind === 'cine_stills' ? shots : 1`. A second special case is where this rots. |
| **Legal / ToS on source footage** | **Stands** — settled by policy, not by this document | |

**The one number that reframes the whole thing.** `fal-ai/wan/v2.2-14b/animate/*` bills **$0.04 / $0.06 / $0.08 per video-second** at 480p / 580p / 720p (16fps basis). Kling O3 Standard, our current default, is **$0.084/s** ($0.42 for 5s). Video-to-video at 720p is *marginally cheaper per second than what we already run*, and half that at 480p.

This is not a premium feature with a premium cost. It is a lateral move in spend for a step change in output.

---

## 2. Why it raises quality — the mechanism, stated precisely

Our i2v pipeline asks a model to **invent** motion from a still. That invention is where every "AI slop" tell lives: floaty gait, morphing hands, dead micro-expression, absent camera shake, no cut rhythm. No amount of model spend fixes it, because the model is being asked to direct.

Video-to-video **inherits** real human motion, real handheld camera, real timing, real framing and light. You stop asking a model to be a good director.

This is orthogonal to the realism chain the [Fannabe assessment](fannabe-viability-assessment-2026-09-09.md) put at P0. That chain fixes **per-frame** realism — plastic skin, drifted face, soft render. This fixes **temporal** realism. They are different failures with different causes, and shipping one does not reduce the need for the other.

We also already hold the hard input: `ugc_character_ref` is a pinned, durable, per-persona face, and it is exactly the one image `animate/move` requires. **The identity work is done.**

---

## 3. The design decision that makes this durable ✅ ALL THREE LANDED

> **G1, G2 and G3 all shipped as specified**, and the test each one was given
> here is the test it passed:
> - **G1** — `type Billing = 'per_call' | 'per_shot' | 'per_second'` (`models.ts`).
>   The `cine_stills` quote specs pass unchanged, which was the stated proof
>   this was a refactor.
> - **G2** — `type HostCapability = 'ffmpeg' | 'videoIngest'` (`formats.ts`),
>   with `buildableWith()` doing the gating. `needsFfmpeg` is gone as a
>   hardcoded name.
> - **G3** — `ModelAdapter.video` plus `video: probe.videoParam` in
>   `adapterFromProbe` (`model-registry.ts`). The consequence predicted here
>   holds literally: `generate.ts` refuses to drive an adapter with no video
>   slot as v2v, "because driving it would send the source clip nowhere and
>   re-run i2v at v2v prices."


> Do not add video-to-video. Add **a source slot** and **a billing basis**. Video-to-video then becomes a catalog entry.

Three named generalizations. Each one *removes* an existing special case rather than adding a parallel one — which is the test for whether a generalization is real.

### G1 — `billing` on a step, replacing the `cine_stills` conditional

`planPipeline` currently hardcodes one multiplier:

```ts
const multiplier = kind === 'cine_stills' ? Math.max(1, Math.min(5, input.shots ?? 4)) : 1;
```

v2v wants a second conditional (duration). The enhancement chain wants a third (per-image passes). Three conditionals in a quote function is where quoting starts to lie.

```ts
type Billing = 'per_call' | 'per_shot' | 'per_second';
```

`cine_stills` declares `per_shot`; v2v declares `per_second`; everything else is `per_call` and quotes byte-identically to today. A single `multiplierFor(step, input)` replaces the conditional.

**Acceptance:** the existing `cine_stills` quote tests pass **unchanged**. That is the proof this is a refactor and not a rewrite.

### G2 — a capability list, replacing `needsFfmpeg`

`needsFfmpeg` is exactly the right rule with a hardcoded name. Generalize it:

```ts
requires?: HostCapability[];   // 'ffmpeg' | 'videoIngest'
```

Format visibility already consults it; the two existing formats keep an identical gate. `videoIngest` becomes the second member, and any future host-dependent format the third — without touching the visibility logic again.

### G3 — a `video` slot on `ModelAdapter` — the highest-leverage line in this plan

The Model Manager builds adapters from a **live OpenAPI probe** (`adapterFromProbe`). Today `ModelAdapter` carries `text`, `image`, `imageIsArray`, `duration`, `audio`, `constants`, `output`. There is **no video-input slot**, so the probe can *see* a `video_url` parameter and has nowhere to put it.

Add the slot plus one line in `adapterFromProbe`, and **every** current and future video-to-video or video-edit model on fal becomes drivable from the Model Manager with no further code. Without it, each one is a bespoke branch inside `generateBrollVideo` forever.

---

## 4. Phases — *as proposed* (see §7b for the inversion, §7c for what shipped)

### Phase 0 — Policy gate (zero code, blocking) ✅ DECIDED — and decided the other way

**The decision, and it is not an engineering one: what may be a source clip?**

Recommended, and consistent with §5 of the Fannabe assessment:

- **A — Uploaded footage** the workspace attests it owns or has licensed.
- **B — A first-party motion library** we shoot or license: generic UGC blocking — unbox, walk-and-talk, mirror turn, pickup-and-show, point-to-text.
- **Never — a URL from a social platform.** No "paste a Reel link" field, in any phase. That field *is* the legal exposure, and it buys nothing B does not.

**B is the strategically interesting half.** The assessment's own prescription was a *"trend format library — structure, pacing, hook shape, not the source asset."* Owned driving footage is that prescription made executable: roughly 30 clips is a one-time content cost that every persona reuses forever, it carries zero third-party IP, and it is the one asset a competitor cannot copy, because it is ours.

**Permanently out of scope:** Character Swap onto a third party's selfie or screenshot. The assessment ruled it a refuse; this plan does not reopen it. **Still true — this one did not change.**

> **Outcome:** the owner chose **A + reel copying** (§7b), not the owned-footage-only
> recommendation above. The recommendation is left standing because its
> reasoning is what shaped the guardrails that *did* ship: no URL ingest, upload
> attestation, per-workspace switch. **The "Never — a URL from a social
> platform" line held.** What changed is that a clip the *user* uploads is
> allowed to be a Reel; what did not change is that we never fetch one.

### Phase 1 — Motion transfer on owned footage (the entire quality win) 🔁 SHIPPED, AS `replace` NOT `move`

**Model:** `fal-ai/wan/v2.2-14b/animate/move` — required `video_url` + `image_url`; `resolution` 480p / 580p / 720p; optional `use_turbo`, `num_inference_steps`, `shift`. Returns `{ video: { url } }`.

Ships as:

1. `video_v2v` added to `ModelKind` **only** — catalog-only, no migration, following the pattern `talking_head` established this week.
2. A `MODEL_CATALOG` entry at the 580p rate as the default.
3. A `PRICING_MATRIX` row declaring `billing: 'per_second'` (G1).
4. `StepKind: 'v2v'`; `FormatNeed: 'sourceVideo'`.
5. Format `motion-transfer`, steps `['director', 'still', 'v2v']`, `requires: ['videoIngest']`. The `still` step is the existing `ensureCharacterRef` — **which is why this is a three-step format and not a new pipeline.**
6. **Ingest endpoint**, modeled on `generate-avatar`'s multipart path: cap 100MB / 30s, probe duration with `runFfmpeg` (already exported), persist via `persistBufferToStorage`, and **quote from the probed duration before the run**. A per-second model with an unprobed input is precisely how a user gets a surprise bill.
7. **Never-brick:** a v2v failure falls back to the existing i2v b-roll path on the same still. The user gets a clip, not an error.

### Phase 2 — The narrative layer (nearly free) ✅ SHIPPED — as `narrated-reel`

Steps `['director', 'still', 'v2v', 'tts', 'mux']`. Every one of the five exists after Phase 1. `muxVoiceover` already handles `hasSourceAudio`, which matters because driving footage carries its own audio to duck or drop. **This phase is a catalog entry and a spec.**

### Phase 3 — Scene replace, gated ⏫ PROMOTED TO PHASE 1 — see §7b

`fal-ai/wan/v2.2-14b/animate/replace` — same adapter, same billing, preserves scene and lighting while replacing the performer. Behind an operator switch in `flags.ts` (not env-only) **and** an upload-time ownership attestation recorded on the row. Only meaningful if Phase 0 chose A.

---

## 5. The invariants that make it durable ✅ ALL SEVEN HELD IN THE BUILD

Each is a checkable rule paired with the failure it prevents. **All seven are
enforced in the shipped code — see §7c for where each one lives.**

1. **Every new stage is metered before it is offered.** Under `credits_mode=enforce`, an unmetered stage is a free path — the standing trap named in the v2 plan. A step with no `PRICING_MATRIX` row must fail the registry-truth test.
2. **Quote from measured input, never assumed duration.** `VIDEO_DURATION='5'` is a per-call assumption; per-second billing turns it into a liability.
3. **Never-brick at every stage.** v2v fails → i2v b-roll. mux fails → un-narrated clip. The discipline already proven by the card renderer and `burnCaptions`.
4. **Capability-gated, not error-gated.** A format the host cannot build is hidden, not sold. This extends the `needsFfmpeg` rule to ingest.
5. **Provenance names what actually ran.** Per the generation truth contract: if the fallback ran, the record says i2v — not v2v.
6. **Source clips are workspace-scoped, attested, and never training input.** An ingested video is user data with a legal claim attached to it.
7. **No URL ingest. Ever.** The single line that keeps this shippable to brand clients.

---

## 6. Sequencing against the open loops

The Fannabe assessment ranks the realism chain (face-fix / skin / upscale) **P0** and reel-copy **P2**. **Do not reorder that** — but note that both are *the same architectural seam*: extra metered passes, per-unit billing, never-brick fallback, host-capability gating. G1 / G2 / G3 are the shared substrate for both.

**Build the substrate once, while doing P0.1.** Video-to-video Phase 1 then costs a fraction of its standalone estimate.

Engine metering (C7) and the enforce flip remain open. Every phase here adds a billable stage, so all of it lands **after C7, not against it** — the same constraint the assessment already named.

**One small defect to fix in passing:** `video.ts` documents `x264DeliveryArgs()` as split out "so the `-filter_complex` callers below can reuse the exact same encode," but `buildVoiceoverArgs` is currently the only such caller. Tighten the comment when Phase 2 adds the second one, or it becomes a stale claim.

---

## 7. Estimate — *superseded; the whole table was done on 2026-09-09*

| Phase | Work | Depends on |
|---|---|---|
| **0** | Policy decision | Owner, not engineering |
| **G1–G3** | Three generalizations, ~1 day, refactor-safe (existing specs pin the behaviour) | — |
| **1** | Ingest endpoint + format + model entry, ~3 days | G1–G3, Phase 0, C7 |
| **2** | Format entry + spec, ~half a day | Phase 1 |
| **3** | Operator switch + attestation, ~1 day | Phase 0 choosing A |

**Validation: done, 2026-09-09 — see §7a.** Cost $0.21. The hypothesis held, and the run surfaced one item that must be added to Phase 1 rather than deferred: **a reframe/aspect step**, because output aspect follows the reference image and a 3:4 clip is not a Reel.

---

## 7b. DECISION 2026-09-09 — reel copying is IN SCOPE, and the phases invert

The owner directed that reel copying ship. That overrides the "owned footage only" recommendation in §4 Phase 0 and the §5 of the Fannabe assessment. Recorded as a decision, not re-argued.

**It changes the build order, because reel copying is `animate/replace`, not `animate/move`** — and `replace` validated *better* than `move` on the two axes that matter for feed output:

| | `move` (was Phase 1) | `replace` (was Phase 3) |
|---|---|---|
| Scene | keeps the REFERENCE's setting | **inherits the SOURCE's** — the point of reel copying |
| Output aspect | follows the reference (got 3:4 — not a Reel) | **follows the source: 720×1280, true 9:16** |
| Needs a reframe step | yes | **no** |

So `replace` becomes **Phase 1** and `move` demotes to an optional format. The reframe work §7a called mandatory is no longer on the critical path — it belongs to `move`.

**What does NOT change:** no URL ingest. Uploading a clip the user chose is a different act from us scraping instagram.com on their behalf, and the scrape adds legal exposure for *us* while buying nothing the upload doesn't. Keep the operator switch per workspace so a brand-client account cannot ship a copy by accident, keep the ownership attestation on upload, and keep the AI-disclosure badge. None of these reduce the feature.

## 7a. Validation result — RUN 2026-09-09, hypothesis CONFIRMED

Run against the real model this plan specifies, `fal-ai/wan/v2.2-14b/animate/move`, using a **real pinned persona** (agent `65142fbc`) and a vendor test clip (fal's own published API-doc sample: 2.56s, 1080×1920, 25fps, full-body dance). No third-party Reel was touched.

**Result: pose transfer is essentially exact and identity survives it.** Across a demanding full-body dance the output held the persona's face, her braided updo with its copper highlights, **her glasses**, and her denim jumpsuit — through a near-profile rotation. Expression is driven too, not frozen. Hands degrade under the fastest motion, which is the familiar failure, but far less than the motion our i2v pipeline invents from nothing.

This is the temporal realism §2 argues for, and it is not reachable by any amount of model spend on the image-to-video path.

### Five operational findings that change the build

1. **Output aspect follows the REFERENCE image, not the driving video.** A 1080×1920 (9:16) driving clip plus an 896×1200 (3:4) reference produced an 816×1104 (3:4) output. For feed-shaped output, Phase 1 must either supply a 9:16 reference or add a reframe step. **This is a required, not optional, part of Phase 1** — a 3:4 clip is not a Reel.
2. **`move` keeps the REFERENCE's setting, not the driving video's.** The output kept the reference's white studio, not the driving clip's outdoor colonnade. So the honest product promise for Phase 1 is *"your persona performing real human motion, in their own scene"* — not *"your persona inside that video."* Scene inheritance is `replace`, which is Phase 3. **Do not market Phase 1 as the latter.**
3. **Latency is ~7 minutes for a 2.6s clip at 720p.** Far above the Kling i2v path. This lands on autopilot scheduling and on the composer's time estimate, and it argues for 480p/580p defaults. The plan's per-second *cost* basis (G1) is correct but incomplete — a latency budget belongs beside it.
4. **`ugc_reference_kit.full_body` is the right input and already exists.** A clean front-facing neutral-pose full-body render on white is exactly what pose transfer wants, and the 5-stage kit already produces one. This is a concrete instance of the assessment's *"we build a richer identity asset and then use less of it."*
5. **Do not validate through Higgsfield.** Two `hf_mult_motion_control` attempts failed with no error detail, and the echoed job params placed the driving video's id inside `reference_images` alongside the still — a routing problem in that wrapper, not a verdict on video-to-video. Neither failure was charged. fal direct worked first try.

### `replace` — validated separately, and it is the stronger model

Same driving clip, same persona full-body reference, `fal-ai/wan/v2.2-14b/animate/replace`. **The output is the source reel with our persona performing it**: same colonnade, same paving, same yellow road markings, same lighting, same poses on the same beats — with the original performer gone and ours in her own denim wardrobe. Face, braids and glasses hold across the sequence, including in close crop.

Its two weaknesses, both real:
- **Hair silhouette drifts toward the source performer.** The reference's tight braided updo comes loose and lengthens under the flick, tracking the original's ponytail. Identity survives; the exact hairstyle does not.
- Hands soften on the fastest frames, and the face is naturally softer at full-body distance than in a bust framing.

### Bust-crop reference: works, but hallucinates everything out of frame

`move` driven from the pinned `ugc_character_ref` (a seated bust-crop selfie) did not fail — it **invented a full lower body, a wardrobe, and an entire room** to fill the frame. That is precisely the from-nothing invention this whole plan exists to escape, and identity is weaker for it.

**Therefore: a full-body reference is a hard requirement, not a nicety.** Any format built on this must read `ugc_reference_kit.full_body` and refuse (or generate the kit stage first) when it is absent. The pinned face alone is not a sufficient input.

### Cost, measured

~$0.21 for 2.6s at 720p, consistent with the published $0.08/video-second. The cost model in §0 holds. Latency ~7 min per 2.6s clip on both `move` and `replace`.

---

## 7c. What actually shipped — the record

Built and in the tree on 2026-09-09. **No migration**, following the
`talking_head` precedent: `video_v2v` is a **catalog-only** `ModelKind`.

### The pieces

| Piece | Where | Note |
|---|---|---|
| **Ingest endpoint** | `POST /api/agent/[agentId]/source-clip` | Synchronous on purpose: the response *is* the quote input. A 202 promising a duration later would put a price on screen that nothing had measured. |
| **`probeVideo` / `hasFfprobe` / `ffprobeBin`** | `src/lib/server/video.ts` | ffprobe is a **separate executable** from ffmpeg, so `FFPROBE_PATH` → sibling of `FFMPEG_PATH` → bare name. Rotation is applied, so `width`/`height` are display dimensions. |
| **Clip bounds** | `video.ts`: `MAX_CLIP_BYTES` 100MB · `MAX_CLIP_SECONDS` 30 · `MIN_CLIP_SECONDS` 1 · `MIN_CLIP_DIMENSION` 128 | The 30s ceiling is **a ceiling on the bill**, not on taste — per-second billing means it is the only thing bounding what one click can cost. Kept in `video.ts` beside the probe so the unit suite can pin them; a route module cannot be imported by the unit suite. |
| **`video_v2v` model kind** | `models.ts` | Catalog-only. Both endpoints registered; `replace` is the default. |
| **Per-second billing** | `models.ts` `Billing` · `pricing.ts` row · `formats.ts` `billedUnits` | The pricing row is the **per-second rate**; the ledger multiplies by the *probed* duration. |
| **Formats** | `formats.ts` | `reel-remake` (`v2v_replace`), `motion-transfer` (`v2v_move`), `narrated-reel` (`v2v_replace` + tts + mux). |
| **Never-brick fallback** | `generate.ts` | A v2v failure falls back to the i2v b-roll path on the still. The user gets a clip, not an error — and the record says **i2v**, with `v2vModelRequested` preserving that a transfer was asked for. |
| **Operator switch** | `VIDEO_INGEST` env / `video_ingest` setting (`flags.ts`, `settings.ts`) | **Default OFF.** Deliberately *not* the same thing as the `videoIngest` HOST capability: this is the policy answer ("may accounts upload a clip"), the capability is the probed fact ("can this host measure one"). Both must be true. |

### The five findings from §7a, as they landed in code

1. **`replace` inherits the source's scene AND its aspect** — 720×1280 out of a 9:16 source. So `reel-remake` needs **no reframe pass** and declares `requires: ['videoIngest']` only.
2. **`move` follows the REFERENCE's aspect**, not the source's — a 3:4 reference yields a 3:4 clip, which is not a Reel. That is exactly why `motion-transfer` declares `requires: ['videoIngest', 'ffmpeg']`: the reframe is an ffmpeg pass. The capability list is carrying a real distinction, not a label.
3. **A full-body reference is a hard requirement.** Driven from the pinned bust-crop, the model invents a lower body, a wardrobe and a room — the from-nothing invention this whole stage exists to escape. The v2v path therefore **throws** rather than degrading when the full-body reference is absent: "a v2v run with no reference cannot degrade into a slightly worse v2v run, only into a different product."
4. **Latency, not cost, picks the rung.** ~7 min for a 2.6s clip at 720p. **580p is the shipped default** for that reason and that reason alone — the money would have argued for 720p.
5. **~$0.21 measured** for 2.6s at 720p, matching the published **$0.08/video-second** at 720p (480p $0.04 · 580p $0.06). The §0 cost model held against a real invoice.

### The step that is quoted because it runs

`reel-remake` is `['director', 'still', 'v2v']` — three steps, not two. The still
is not decoration: it is the post's poster frame and the anchor the never-brick
fallback re-performs from. It runs, so it is quoted. *A stage that bills but is
not quoted is the same lie as one that is quoted but never runs, only harder to
notice.*

### Deploy runtime — the silent-failure surface 🔒 CLOSED

The `videoIngest` capability resolves through `hasFfprobe()`, and the failure
mode is **invisible**: no ffprobe → capability false → the three v2v formats are
simply **hidden** in the composer. No error, no log, nothing to diagnose — the
feature would just not exist in production.

Verified against the Alpine package index (branches v3.21, v3.22 and edge):
**`/usr/bin/ffprobe` ships inside the `ffmpeg` package itself.** Only `ffplay`
is split out; there is no `ffmpeg-tools` package. So `apk add ffmpeg` in
`personagen-svelte/Dockerfile` is already sufficient — but the image now carries
a **build-time assertion** on both `ffmpeg` and `ffprobe`, so that a base-image
bump or an upstream subpackage split becomes a loud build failure instead of a
paid feature quietly vanishing from the composer.

`FFMPEG_PATH` and `FFPROBE_PATH` are both documented in the repo-root
`.env.example`, for hosts that need the override.

### Still open

- **C7 engine metering and the `credits_mode=enforce` flip.** Unchanged by this
  work and still the gate — §6's constraint stands: every phase here adds a
  billable stage, so all of it lands *after* C7, not against it.
- **Ownership attestation on upload** (§7b) — named as a required guardrail,
  not yet built. The operator switch exists but is **global** (env or admin
  setting), not per-workspace; §7b asked for per-workspace so a brand-client
  account cannot ship a copy by accident, and that narrowing is still owed.
- **Nothing is live until the switch is flipped.** `VIDEO_INGEST` defaults to
  off, so the formats are hidden in production today for policy reasons on top
  of the capability gate. That is the correct default for a feature whose
  guardrails are incomplete — but it means "shipped" here means *in the tree*,
  not *reachable by a user*.
- **The `x264DeliveryArgs()` comment defect** named at the end of §6: Phase 2
  shipped, so `buildVoiceoverArgs` now has company and the comment should be
  tightened.
- **A first-party motion library** (§4 Phase 0, option B). Reel copying shipping
  does not retire this — it is still the one asset a competitor cannot copy.

---

## 8. Bottom line

Video-to-video is the only available lever that fixes **temporal** realism — the failure our image-to-video pipeline is structurally incapable of fixing at any price. **This is now measured, not argued: see §7a.** It is per-second cost-neutral against what we already spend. Three of its four engineering blockers were removed this week by work done for other reasons, and the fourth (ingest) is one endpoint modeled on one that already exists.

The two things the validation changed: Phase 1 must include an aspect/reframe step, and Phase 1's promise is *"your persona performing real motion in their own scene"* — scene inheritance is Phase 3.

> **Both of those were then overtaken the same day.** `replace` became Phase 1
> (§7b), which inherits the source's aspect and needs no reframe, and whose
> promise *is* scene inheritance. The reframe requirement survives only on
> `motion-transfer`, which is why that format — and not `reel-remake` — declares
> `ffmpeg`.

The binding constraint is legal, not technical — and the owned-footage variant sidesteps it entirely while keeping the quality gain, converting the assessment's "trend format library" from a recommendation into an asset we own.

> **The owner took the other branch** (§7b): reel copying is in scope, with the
> guardrails the owned-footage argument produced kept intact — no URL ingest,
> upload attestation, per-workspace switch, AI-disclosure badge. The legal
> constraint did not go away; it was priced and accepted, and the guardrails are
> what the acceptance rests on. Two of the three are still to build (§7c,
> "Still open").

---

## Sources

- [Wan-2.2 Animate Replace — API](https://fal.ai/models/fal-ai/wan/v2.2-14b/animate/replace/api)
- [Wan-2.2 Animate Move](https://fal.ai/models/fal-ai/wan/v2.2-14b/animate/move)
- [Fannabe](https://www.fannabe.com/) · [Best AI Influencer Generators 2026](https://www.fannabe.com/articles/best-ai-influencer-generators)
