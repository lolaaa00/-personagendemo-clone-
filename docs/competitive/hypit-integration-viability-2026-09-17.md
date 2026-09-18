# Hypit — Integration Viability Assessment

**Date:** 2026-09-17
**Subject:** `@hypit/hypit` v0.2.3 (Hypit.AI) — `github.com/hypit-ai/hypit`, `hypit.ai`
**Measured against:** PersonaGen at `ux/portal-overhaul` (`e1bbdea`)
**Method:** npm registry packument, the published README, and the repository `LICENSE` fetched live on 2026-09-17. Every PersonaGen claim below is a file:line read at `e1bbdea`. Nothing here is from memory.
**Companion docs:** [fannabe-viability-assessment-2026-09-09.md](fannabe-viability-assessment-2026-09-09.md) · [realism-chain-feasibility-2026-09-09.md](realism-chain-feasibility-2026-09-09.md) · [video-to-video-implementation-plan.md](video-to-video-implementation-plan.md) · [state-reassessment-2026-09-17.md](../audit/state-reassessment-2026-09-17.md)

> **Note on the measurement point.** This was written against `e1bbdea` on a branch that reached `b481432` — sixteen commits — while it was being written, with three sessions committing into the same tree. Every finding about **Hypit** and about our caption timing was re-verified at `d8c3221` and again at `b481432`, and none of them changed. What *did* change is the Fannabe program this document compares itself against, twice; §6 carries the correction and preserves what it replaced. The fuller picture is in [state-reassessment-2026-09-17.md](../audit/state-reassessment-2026-09-17.md).

---

## 0. Executive verdict

**Do not integrate Hypit. Take one idea from it, which is worth more than the package.**

Two independent findings, either of which is sufficient on its own:

**1. The licence prohibits exactly what we are.** Hypit ships under a modified Apache 2.0 whose first added condition forbids multi-tenant operation, and it defines "tenant" in terms that name our architecture precisely:

> *"one tenant corresponds to one workspace — the isolated set of projects, artifacts, credentials, and configuration belonging to a single party. Operating an environment in which two or more parties outside your own organization hold separate workspaces constitutes a multi-tenant service, **whether or not a fee is charged**."*

PersonaGen is a workspace product ([workspaces.ts](../../personagen-svelte/src/lib/server/workspaces.ts), `/api/workspaces`, per-account wallets). Wiring Hypit into the engine to serve our customers requires written authorisation from Hypit.AI. Not attribution — authorisation. The fee-agnostic clause closes the "but it's only on the free tier" reading before it opens.

**2. We already built its architecture, independently.** Hypit's thesis is that a video should be a *reusable, editable composition* rather than a one-off render. [formats.ts](../../personagen-svelte/src/lib/formats.ts) already declares sixteen formats as step graphs — `steps: ['director', 'grader', 'still', 'tts', 'talkinghead']` — compiled to ffmpeg and model calls. `motion-card` already renders video with *"No image model, no video model"*. [card-renderer.ts](../../personagen-svelte/src/lib/server/content/card-renderer.ts) is 518 lines of code-rendered 1080×1920 typography at $0. The shape Hypit sells, we have.

What we do **not** have is the one mechanism that makes Hypit's compositions hold together, and it is narrow enough to name in a sentence:

> **Hypit anchors captions to words by aligning against the audio. We anchor captions to numbers a language model guessed.**

That is the transferable finding, it is independent of the licence, and §4 costs it out. **The cost turns out to be one boolean.** The TTS endpoint already in production returns per-word timestamps on request, and we do not request them — see §4.

| Question | Answer |
|---|---|
| Embed Hypit in the engine (tenant-facing)? | **No** — prohibited by licence §1(a) without written authorisation. |
| Bundle or redistribute it in our product? | **No** — prohibited by §1(b). |
| Use it in-house to make *our own* marketing video? | **Yes, permitted** — but §1(c) forbids removing Hypit branding from any user-facing surface derived from its CLI, run reports or manifests. |
| Adopt word-anchored caption timing ourselves? | **Yes — P1, and it pays for itself.** See §4. |
| Does this displace the Fannabe P0? | **No.** See §6. |

---

## 1. What Hypit actually is

Measured from the registry, not the marketing.

| Fact | Value |
|---|---|
| Package | `@hypit/hypit` |
| Latest | **0.2.3**, published **2026-09-17** |
| First publish | **2026-08-18** — 20 versions in 30 days |
| Licence | "SEE LICENSE IN LICENSE" — modified Apache 2.0 (§2) |
| Engine | Node **>= 22.15.0** |
| Binary | `hypit` → `bin/hypit.mjs` |
| Runtime deps | `tsx`, `vite`, `typescript`, `puppeteer-core`, `@puppeteer/browsers`, `sharp`, `koffi`, `cjs-module-lexer`, `cmu-pronouncing-dictionary` |
| Install | `npm i -g @hypit/hypit`, then `npx skills add hypit-ai/hypit -g` |
| Homepage | `hypit.ai` |

**The pitch:** *"Clone any viral video with AI agents — 1 command, 100 variants."* You give an agent a reference video; it decomposes it into **SVML**, a markup language describing the whole workflow — footage, captions, B-roll, effects — *"all anchored to words instead of seconds."* The composition is then re-runnable with parts swapped: host, hook, product, language, aspect ratio.

**Read the dependency list, because it tells you more than the README.** `puppeteer-core` + `@puppeteer/browsers` means visuals are rendered by headless Chromium from front-end code — the same trick as our ffmpeg cards, with a browser instead of a filter graph, which buys arbitrary CSS/DOM/animation. `cmu-pronouncing-dictionary` is a phoneme lexicon: it derives word timing from *pronunciation*, cheaply, without a transcription model in the loop. `koffi` is an FFI binding — native library calls. `sharp` is image processing. This is a local render engine, not a wrapper around an API.

**The honest part of their pitch:** *"a workflow can compile captions, motion graphics and code-rendered visuals into a finished video without calling a generation model or incurring its service charges."* That is the same economics as our `$0` card renderer, and it is the right instinct.

**Maturity caveat.** One month old, twenty releases, no published history before 2026-08-18. Version 0.1.10 — the version described in the source conversation — is eleven releases stale as of today. Nothing at this velocity is a dependency you put under a billing path.

---

## 2. The licence — verbatim, because this is the verdict

Fetched from `raw.githubusercontent.com/hypit-ai/hypit/main/LICENSE` on 2026-09-17.

**Prohibited without a written commercial licence from Hypit.AI:**

- **§1(a) Multi-tenant service** — *"you may not use the Hypit source code, or any derivative work of it, to operate a multi-tenant environment, or to offer Hypit's functionality to third parties as a hosted, managed, or software-as-a-service offering."* Tenant is defined as one workspace; two or more outside parties holding separate workspaces is multi-tenancy, **fee or no fee**.
- **§1(b) Commercial redistribution** — no selling, licensing for a fee, or supplying for commercial gain, *"whether standalone or as a component of, or bundled with, any product."* Forking and publishing source is permitted **only** under the same licence and **not for commercial gain**.
- **§1(c) Branding** — *"you may not remove or modify the name, LOGO, or copyright information presented in the Hypit command-line interface, its generated run reports and manifests, or any user-facing surface derived from them."*

**Explicitly permitted:**

- Running it yourself on your own infrastructure.
- *"using it for your own organization's work, including commercial work and **work performed for your clients**"*.
- Single-tenant deployments operated by and for one organisation.
- **§3 Output ownership:** *"The producer claims no rights in the content you create with Hypit."* Videos, audio, images and manifests are yours, with no conditions, including commercial use.

### 2.1 What that means for us, precisely

| Use | Permitted? | Why |
|---|---|---|
| Hypit inside `generate.ts`, producing video for PersonaGen customers | **No** | §1(a). Our customers hold separate workspaces. |
| Hypit behind an operator-only flag, still producing customer deliverables | **No** | §1(a) is about who the workspaces belong to, not who pushes the button. |
| Shipping Hypit inside the Docker image we hand a client to self-host | **No** | §1(b) — bundled with a product supplied to a third party. |
| **Our own team running Hypit locally to make videos for a client account we operate** | **Yes** | §1's explicit carve-out for "work performed for your clients". This is the agency lane, and it is clean. |
| Our own landing-page / launch / docs videos | **Yes** | Own-organisation work. |
| Selling those videos' output | **Yes** | §3 — output is unencumbered. |

**The one trap in the permitted column.** §1(c) survives the carve-out. If an agency-lane run surfaces a Hypit run report or manifest to a client — inside a deliverable, an approval screen, a shared folder — the Hypit name has to stay on it. That is fine for an internal pipeline and awkward the moment a client-facing artefact quotes it. Keep Hypit output at the *asset* boundary (an mp4 we hand over) and never at the *manifest* boundary.

**On asking for authorisation.** §1(a) and §1(b) both open with *"Unless explicitly authorized by Hypit.AI in writing."* A commercial licence is a real option, not a dead end. It is simply a vendor negotiation with a one-month-old company, and it should be priced against §4's finding — which is that the part we actually want costs us one engineering task and no vendor at all.

---

## 3. Cross-reference — what Hypit has that we don't

Everything in the PersonaGen column is read at `e1bbdea`.

| Capability | Hypit | PersonaGen | Verdict |
|---|---|---|---|
| Composition as a re-runnable artefact | SVML source, edited and re-run | `steps: [...]` graphs in [formats.ts](../../personagen-svelte/src/lib/formats.ts), 16 formats | **Parity in kind**, not in editability — ours is a fixed catalogue, theirs is per-project source |
| Code-rendered video, no model calls | Headless Chromium + front-end code | `motion-card` + [card-renderer.ts](../../personagen-svelte/src/lib/server/content/card-renderer.ts), ffmpeg drawtext, 5 layouts, curated palettes | **Ours is narrower** (typography only) but shipped, metered and $0 |
| Video-to-video / clone a reference | Core pitch | `reel-remake`, `motion-transfer`, `narrated-reel` — shipped, consent-gated, never-brick i2v fallback | **Parity**, and ours has the guardrails |
| **Word-anchored caption timing** | **Forced alignment against audio; `cmu-pronouncing-dictionary` in-tree** | **Model-guessed `at`/`until`**, line-level `drawtext`, capped at `MAX_TIMED_CAPTIONS` — [video.ts:357](../../personagen-svelte/src/lib/server/video.ts#L357) | **Behind — and it is the whole finding** |
| One composition → N variants | Headline claim | `campaign`, `series` formats exist; each run re-derives | **Behind** — we re-generate where they re-render |
| Distribution, approval, ledger, 13 platforms | **None** | The entire product | **Uncontested, ours** |
| Multi-tenant SaaS | **Forbidden by own licence** | What we are | **Uncontested, ours** |

### 3.1 The caption-timing gap, precisely

Our caption track is built in [buildCaptionPlan()](../../personagen-svelte/src/lib/server/video.ts#L357). The timings on it — `at`, `until` — arrive as numbers on `opts.track`, and for every narrated format except one they are **written by the Director model**, which has never heard the audio. The function is careful about everything it can control (it refuses to sort by `at`, because a mistimed entry printing its number in the wrong row *"looks like our bug rather than theirs"*) — but it cannot correct a timing that was guessed.

**There is exactly one format that does this honestly, and the way it does it is the argument.** `listicle` synthesises the voiceover **per item**, joins the segments, and derives reveal times from the measured durations — [generate.ts:1529](../../personagen-svelte/src/lib/server/content/generate.ts#L1529): *"reveal times are then arithmetic on real durations rather than a guess."* [buildListicleTrack()](../../personagen-svelte/src/lib/server/content/generate.ts#L1671) then indexes `startsAt`, and the format comment in `formats.ts` states the reason outright: per-item voiceover is *"the only way the on-screen reveals can be timed to speech rather than guessed."*

That comment is true today and it is the admission. We pay **N TTS calls to recover segment boundaries that one aligned call would give us for free**, we get *segment*-level accuracy rather than word-level, and we get it for one format out of sixteen. Every other narrated format — `spokesperson`, `vo-broll`, `narrated-reel` — still burns captions on model-guessed timings.

No timestamp or alignment request exists anywhere in the codebase: a grep for `timestamp|alignment|with_timestamps|word_boundar` across `voices.ts`, `video.ts` and `generate.ts` returns one hit, and it is a comment about a different subject.

**And the reason that matters is §4: the data is already on the other end of a call we are already paying for.**

---

## 4. The one upgrade worth taking — word-anchored captions

**Take the idea, not the package.** This needs no Hypit code, no licence, and — measured below — **no new vendor, no new model and no new spend.**

### 4.1 The measured finding

Our TTS model is set at [generate.ts:176](../../personagen-svelte/src/lib/server/content/generate.ts#L176):

```ts
export const TTS_MODEL = env.UGC_TTS_MODEL || 'fal-ai/elevenlabs/tts/turbo-v2.5';
```

That endpoint's OpenAPI spec, fetched live from `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/elevenlabs/tts/turbo-v2.5` on 2026-09-17, declares this output field:

| Field | Type | Description (verbatim from the spec) |
|---|---|---|
| `timestamps` | `array \| null` | *"Timestamps for each **word** in the generated speech. **Only returned if `timestamps` is set to True in the request.**"* |
| `audio` | `File` | The generated audio file |

`timestamps` is also an accepted **input** parameter, alongside `text`, `voice`, `stability`, `similarity_boost`, `style`, `speed`, `previous_text`, `next_text`, `language_code` and `apply_text_normalization`. The same field is present on `fal-ai/elevenlabs/tts/multilingual-v2`.

Our call, at [generate.ts:1492](../../personagen-svelte/src/lib/server/content/generate.ts#L1492):

```ts
const call = (v: string) =>
    falSyncJson(ttsModel, { text, voice: v, stability: 0.5, similarity_boost: 0.75 }, falKey);
```

**We do not set `timestamps`.** And four lines later `generateVoiceAudio` returns `{ url, voiceUsed }` — so even if the field arrived, the function signature discards it.

**The gap between us and Hypit's headline mechanism is one request flag and one widened return type, on a model we already pay for, on a call we already make for every narrated format.**

### 4.2 Order of work

1. **Set `timestamps: true` and measure the response.** Confirm the array's actual element shape — the spec types `items` as `{}` (unconstrained), so the per-word field names must be read off a real response, not assumed. Confirm on the same call whether fal's price changes; the published basis is per-call, so it very likely does not, but the quote path must not learn that from this document.
2. **Widen `generateVoiceAudio`'s return** to carry the word list alongside `{ url, voiceUsed }`, and thread it to the caption builder.
3. **Widen `TimedCaption` to carry word-level entries**, keeping `buildCaptionPlan` pure — the file's own stated reason for being pure is that *"every caption bug this app has shipped was a wrong filter string,"* and that holds harder when entries multiply by 10×. `MAX_TIMED_CAPTIONS` was sized for guessed lines and must be re-derived for words, not raised blindly; the bottom-anchored row maths assumes a handful of stacked lines.
4. **Feed real timings to every narrated format**, not just `listicle`.
5. **Then retire the per-item TTS hack** — and only then. It is currently the *most* honest path in the codebase; it must not be removed until the thing replacing it is measured to be better.

**Why it pays for itself.** Step 5 removes N−1 TTS calls per listicle run — on a six-item list, five calls of pure waste today, spent to recover segment boundaries that step 1 returns for free at word granularity. The upgrade is plausibly **cost-negative** while being the single most visible quality change available in short-form video: word-anchored captions are the format's defining look, and they are the reason Hypit leads with *"anchored to words instead of seconds."*

**Do not take:** SVML as a format (we have step graphs), headless-Chromium rendering (ffmpeg cards are shipped, metered and cheaper to reason about), or "clone any viral video" as a *product* claim — that argument was already had and settled in [fannabe-viability-assessment-2026-09-09.md](fannabe-viability-assessment-2026-09-09.md) §5, and v2v shipped on the guardrails that refusal produced.

---

## 5. Risks

| Risk | Severity | Note |
|---|---|---|
| Treating §1(a) as an attribution requirement | **High** | It is a prohibition. Attribution satisfies §1(c), not §1(a). |
| "Operator-only flag" reasoning | **High** | Tenancy is defined by whose workspace holds the artefacts, not by who triggers the run. |
| Depending on 0.2.x under a billing path | **High** | 20 releases in 30 days, one month old, no public history before 2026-08-18. |
| Hypit manifests reaching a client surface in the agency lane | Medium | §1(c) keeps their branding on it. Hand over assets, not manifests. |
| Raising `MAX_TIMED_CAPTIONS` blind for word entries | Medium | The bottom-anchored row maths in `buildCaptionPlan` is sized for lines. |
| Removing the per-item TTS path before the replacement is measured | Medium | It is the only timing in the product that is currently honest. |

---

## 6. Where this sits against the Fannabe program

**It does not displace it**, and between the first draft of this section and this correction, the Fannabe program moved further than it had in the preceding eight days.

> **Corrected at `b481432`, later the same day.** The paragraph this replaces said the enhancement chain "has not moved" and the creation preview was untouched. Both were true when measured at `d8c3221` and are **no longer true**. What follows is the state at `b481432`; the original claim is preserved here rather than quietly overwritten because this document's whole argument rests on measuring instead of remembering.

**Fannabe P0.3 shipped, both halves.** `08d3f8a` wired the chip trait picker into the creation wizard *and* added `/api/persona-preview` — a synchronous, metered, agentless-gated portrait for a persona that does not exist yet, built from `buildHeroPortraitPrompt` off `buildStoredProfile` so the preview is the same thing the persona is born with. The landing page's step 01 and step 02 claims are now honest.

**Fannabe P0.1 shipped its first stage.** `cfd5fe5` added `enhance.ts`: an upscale pass after generation, `fal-ai/esrgan` by default, 120 s timeout, no throw path out of `enhanceImage` so every failure returns the original and bills nothing. Verified at `b481432` — `esrgan`, `upscaleUsd` and `enhanceImage` are live in `src/`; `codeformer`, `seedvr`, `realesrgan` and any skin pass remain at **zero**, and `EnhanceChainSetting` accepts only `'off' | 'upscale'`, so stages A and B are deferred by construction rather than half-wired.

**One recommendation of mine was not taken, and the choice made instead is defensible.** §6 of the first draft argued P0.1 should read the `QualityTier` axis that already exists (`'budget' | 'balanced' | 'premium'` in [models.ts:39](../../personagen-svelte/src/lib/models.ts#L39), with a per-stage `tier?: QualityTier | 'manual'` lock in [formats.ts:483](../../personagen-svelte/src/lib/formats.ts#L483)). It does not: `upscaleUsd()` reads an **operator-declared** flat rate from `UGC_UPSCALE_USD` and refuses to run unpriced. For a compute-second-billed model that is the safer call — a declared rate bounds the bill where the basis cannot — and the tier axis remains available for when a *user-facing* quality choice is wanted rather than an operator switch. The recommendation stands for that later step, not for this one.

**None of this touches the finding in §4.** Re-verified at `b481432`: the TTS call at [generate.ts:1493](../../personagen-svelte/src/lib/server/content/generate.ts#L1493) still passes `{ text, voice, stability, similarity_boost }`, and `timestamps` appears **zero** times in the entire file. The word-anchored caption gap is exactly where it was, and it is now the *only* item from either program still sitting in the first ninety seconds of the product.

The two programs still touch different organs and different buyers:

- **Fannabe P0 → the still image, at evaluation time.** A cold visitor generating one image and judging it. **Stage C now built; stages A and B deferred.**
- **Hypit P1 → the narrated video, at delivery time.** An existing customer's reel looking professionally captioned. Cheap, possibly cost-negative, one engineering task — and **still not started**.

**Ordering:** Fannabe P0 first — it decides whether "ultra realistic" is a claim we can make. Word-anchored captions next, because they are the cheapest genuine quality jump left in video and they delete a cost line on the way in.

---

## 7. Bottom line

Hypit is a well-made, fast-moving, one-month-old local render engine whose licence is written specifically to keep products like ours out of it, and whose core architecture we arrived at independently and shipped with billing, guardrails and a never-brick fallback attached.

The correct posture is neither adoption nor dismissal:

1. **Do not integrate it.** §1(a) is unambiguous and fee-agnostic.
2. **Use it in-house if it is useful** for our own marketing video — explicitly permitted, output unencumbered, keep its branding off client-facing manifests.
3. **Take the one idea it is right about.** Our captions are timed by a model that has not heard the audio, and we already know this — `listicle` works around it by paying for N voiceovers to recover boundaries one aligned call would give us. The endpoint we already use returns per-word timestamps when asked; we have never asked. Set the flag, thread the array, and every narrated format improves at once, the workaround retires, and the TTS bill goes down.

The finding that survives the licence is the finding worth having — and it turned out to be a boolean we were not sending.

---

## Sources

- [`@hypit/hypit` on npm](https://www.npmjs.com/package/@hypit/hypit) — registry packument fetched 2026-09-17
- [hypit-ai/hypit — README](https://github.com/hypit-ai/hypit)
- [hypit-ai/hypit — LICENSE](https://github.com/hypit-ai/hypit/blob/main/LICENSE) — fetched 2026-09-17
- [hypit.ai](https://hypit.ai)
- `fal-ai/elevenlabs/tts/turbo-v2.5` and `fal-ai/elevenlabs/tts/multilingual-v2` OpenAPI specs — `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<id>`, fetched 2026-09-17
- PersonaGen at `e1bbdea`: `formats.ts`, `video.ts`, `content/generate.ts`, `content/card-renderer.ts`, `server/workspaces.ts`
