# Fannabe — Deep Teardown & Cross-Referenced Viability Assessment

**Date:** 2026-09-09 · **Re-measured:** 2026-09-17
**Subject:** `fannabe.com` (Zillatech Limited, Paralimni, Cyprus)
**Measured against:** PersonaGen at `b6b4c27` (original) · **re-measured against `e1bbdea`** (2026-09-17)
**Companion docs:** [market-gap-assessment.md](market-gap-assessment.md) (2026-07-25, theinfluencer.ai / Higgsfield / createpersona), [viability-assessment-2026-09-07.md](../monetization/viability-assessment-2026-09-07.md), [persona-model-v2-action-plan.md](persona-model-v2-action-plan.md)

---

## 0.0 Revision — 2026-09-17 (eight days on, re-measured against `e1bbdea`)

Thirty-plus commits landed since this was written. Three of this document's findings moved; the central one did not.

**Was the only remaining realism P0 — and it moved later the same day:**

> **The enhancement chain was absent.** Re-verified by search across `src/` at `e1bbdea`: no upscaler, no face restoration, no skin/detail pass. That measurement is what prompted P0.1, whose first stage (upscale) shipped hours later. **Do not read that as the gap being closed** — the pass is wired into one call site out of fourteen, and has never been benchmarked or run live. See *One round deeper* below, which is the honest state.

**Closed since 09-09:**

| Item | Status |
|---|---|
| Motion transfer + reel copy | ✅ Shipped as `reel-remake` and `motion-transfer` in the format catalog, on the guardrails §5 argued for — upload-only (no URL ingest), ownership attestation at upload, `video_ingest` operator flag, per-second billing off a *measured* clip duration ([source-clip/+server.ts](../../personagen-svelte/src/routes/api/agent/[agentId]/source-clip/+server.ts)). See the same-day correction in §3.2. |
| Format breadth | ✅ **16-format catalog** ([formats.ts](../../personagen-svelte/src/lib/formats.ts)) across image / video / series, each quoted before confirm. The §3.3 "behind on breadth" verdict is now **closed** — see the revised scorecard below. |
| Cost transparency | ✅ Extended — a forged clip duration that quoted $0.30 and billed $1.80 was caught and fixed (`c952175`); `FormatExplorer` was under-quoting markup by 3× and was fixed (`94eb7b4`). |
| Landing overstatement | ⚠️ **Partly** fixed by the 09-11 landing rework. The "regenerate as many times as you want" promise is gone; step 03 now describes the real mechanism ("a five-stage reference set locks the face"), which is accurate. **What remains is narrower — see the revised integrity flag in §3.2.** |

**Not closed, and the recommendation stands unchanged:**

- ~~**Creation is still free-text, with no preview.**~~ **Closed later the same day — see the P0.3 status in §4.** This bullet recorded the measurement that prompted the fix: the wizard took ethnicity as a lone text input and rendered no portrait at any step. Both are now gone.
- **The free tier is still one-time.** The copy changed — "One free credit per person to start" ([plans.ts:36](../../personagen-svelte/src/lib/server/plans.ts#L36)) — but the structure did not. Fannabe still gives recurring monthly credits and we still don't. §6 observation 1 stands.
- Carousel, Explore gallery, prebuilt personas, prompt enhancer: all still ❌.

**Revised scorecard (changes only):**

| Dimension | Fannabe | PersonaGen 09-09 | **PersonaGen 09-17** |
|---|---|---|---|
| Content-format breadth | 8 | 5 | **8 — parity reached** |
| Cost transparency & accounting | 2 | 9 | **10** |
| Per-image photorealism | 8 | 5 | **5 — mechanism shipped, unproven** (P0.1 stage 1; 1 of 14 call sites, no benchmark) |
| Creation UX | 9 | 4 | **7 — P0.3 shipped 09-17** (see §4) |

**Net:** we closed the format gap and widened the accounting lead, and did not touch either of the two gaps that decide a cold buyer's first impression. The §8 ordering is unchanged and now more lopsided than when it was written.

---

## 0. Executive verdict

**Fannabe is not our competitor. It is our craft teacher.**

That distinction is the whole assessment, and getting it wrong would be expensive. Fannabe sells **adult-creator monetization** — it is an 18+ platform, it says so, it routes payments through a high-risk processor specifically to support NSFW, its named integration is **Fanvue**, and its stated buyer is "OnlyFans models, OnlyFans agencies, AI creators." Its own review coverage names "NSFW positioning excludes brand-safe teams" as a limitation.

PersonaGen sells **brand-safe, client-accountable account operation** — brand briefs, product scraping, approval queues, verified publishing to 13 platforms, a per-persona spend ledger. Our buyer answers to a client. Theirs answers to nobody.

So there are two separate questions, and they have different answers:

| Question | Answer |
|---|---|
| Should we copy Fannabe's **business**? | **No.** It is a different market with a different risk profile, a different payment stack, and a legal posture we cannot adopt without losing every brand customer we are building for. |
| Should we copy Fannabe's **image craft**? | **Yes — urgently.** They are ahead of us on the thing you actually asked about, and the gap is specific, closable, and cheaper than it looks. |

**The single most important finding of this teardown:**

> Fannabe's hyper-realism does not come from a better base model. It comes from a **post-processing chain** — `Fix Face` → `AI Skin Enhancer` → `AI Image Upscale` — applied *after* generation. We have **none of these three stages**. Our pipeline ends at the base model's raw output.

That is the gap. It is not a model-selection problem, not a prompt problem, and not a training problem. It is three missing pipeline stages. Verified absent by search across the whole codebase: no upscaler, no face restoration, no skin/detail pass exists anywhere in `src/`.

**Scorecard (0–10, higher is better):**

| Dimension | Fannabe | PersonaGen | Verdict |
|---|---|---|---|
| Per-image photorealism | **8** | 5 | **Behind — P0** |
| Identity consistency | **8** | 6 | Behind — P0 |
| Creation UX (time-to-first-face) | **9** | 4 → **7** | Was behind — P0.3 shipped 09-17 |
| Content-format breadth (carousel, trend-copy, swap) | **8** | 5 | Behind — P1 |
| Distribution & operations | 0 | **9** | 🏆 Uncontested |
| Brand grounding | 0 | **9** | 🏆 Uncontested |
| Cost transparency & accounting | 2 | **9** | 🏆 Uncontested |
| Legal integrity / ownership | **3** | 7 | Ahead — and exploitable |
| Commercial surface (landing, pricing, billing) | 8 | 6 | Closing |

**Weighted verdict: we are a stronger *product* and a weaker *studio*.** For a buyer whose first evaluation act is "make me one image and let me judge it," weaker studio loses the deal before stronger product is ever seen. That is why the realism work is P0 and not P2.

---

## 1. Fannabe teardown

### 1.1 Positioning

- **H1:** "Ultra Realistic AI Influencer Generator"
- **Sub:** "Create AI influencers in minutes, grow their social media pages and turn their audience into revenue."
- **Core claim:** "Fannabe helps you create hyper-realistic AI characters that you can monetize."

Note the copy architecture: **realism is the headline, monetization is the subhead.** They lead with the artifact, not the outcome. We lead with the outcome ("We run the account"). Both are defensible — but theirs converts faster on a cold visitor because the proof is visual and immediate, and ours requires the visitor to already believe there is an operations problem worth solving.

### 1.2 The full feature set (17 surfaces)

| # | Feature | What it is |
|---|---|---|
| 1 | AI Character Creation | Chip-select ethnicity, age, hair, body, eye colour, traits |
| 2 | Viral Trend Generator | Multi-image/video edits with caption, storyline, sound |
| 3 | Niche Generator | Professional niche (police officer, teacher, boxer) → niche-tuned content |
| 4 | Unique Features | Vitiligo, scars, heterochromia, two-headed |
| 5 | **Viral Reels Copy** | "Copy any Reels or TikTok with a click" — their self-declared "killer feature of 2026" |
| 6 | **Character Swap** | Swap the character onto an Instagram screenshot or a personal selfie |
| 7 | **Carousel Creation** | One-click IG carousel, consistent outfit + background across frames |
| 8 | AI Image Generator | Prompt → ultra-realistic image |
| 9 | AI Video Generator | Image → motion, identity preserved |
| 10 | AI Talking Video | Speech + synced lips |
| 11 | **Easy Mode** | Pre-curated themes/outfits, zero prompt writing (Monaco, Flight Mode, Mirror Selfie) |
| 12 | **Image to Prompt** | Upload an image → decoded into a prompt |
| 13 | AI Image Editor | Backgrounds, composition, element removal |
| 14 | **AI Skin Enhancer** | "Automatically refines the skin texture and appearance" |
| 15 | **AI Image Upscale** | Resolution increase without quality loss |
| 16 | Model Upload | Accept an existing likeness (**contradicted by their own terms — see §1.6**) |
| 17 | Prebuilt Models | Ready-made influencers, instant start |

Plus **"Fix Face"** technology, named on the homepage but not given its own feature card.

### 1.3 The flow

```
1. CREATE      click attributes → influencer ready "in a few minutes"
2. GENERATE    prompt, OR one-click copy from the Explore tab, OR AI Prompt Enhancer
3. MONETIZE    post to IG / TikTok / X → grow → income
```

Two-tier interaction model, explicitly named:
- **Easy Mode** — "pick a scene, such as Monaco, Flight Mode, or a Mirror Selfie"
- **Expert Mode** — text prompting

**The `Explore` tab is the piece we most underrate.** It is a gallery of other users' outputs with a one-click "copy this prompt/setup" action. It solves cold-start ("what do I even make?") without a single line of AI, and it compounds: every user who generates makes the tab better for the next user. It is a content flywheel disguised as a UI tab.

### 1.4 Consistency claims

- "100% consistent, same face and body across all images **and model engines**"
- "we can keep the consistency across multiple different large image models"
- Explicitly contrasted against competitors needing "2–3 hours just to train a model"

**Read that carefully.** They are claiming consistency *without* per-user model training, held *across* different base engines. That is only achievable with a reference-conditioning + face-restoration architecture — a pinned master identity, passed as a reference into multi-reference edit models, then corrected by a dedicated face pass. **This is architecturally the same family as our reference kit** (`ugc_reference_kit`, 5 stages, `generate.ts:2656`) — we simply stop one stage earlier than they do.

### 1.5 Pricing

| Item | Value |
|---|---|
| Model | Prepaid **tokens/credits**, consumed per output |
| Range | **Free → ~$29–$199/mo** (directional; they publish no plan table) |
| Free tier | Monthly free credits + "a lot of options to get extra free credits"; enough for "a picture post every day" |
| Top-ups | Packs for heavy months |
| Per-generation costs | **Not published anywhere** |
| Processor | High-risk (NSFW-permitting) |

**Pricing opacity is a deliberate choice and a real weakness.** Third-party reviewers flag it directly: "Pricing visibility is a meaningful limitation when comparing total batch cost." A buyer cannot compute what a month costs before paying. We can beat this trivially — we already do, and don't get credit for it.

### 1.6 Integrity problems — the exploitable seam

This is where they are genuinely weak, and it maps precisely to your "high integrity" requirement.

1. **The homepage contradicts the terms.** The site says you can upload your own model's likeness ("Yes! If you are an OnlyFans model, OnlyFans agency, or an AI creator..."). The terms and privacy policy state user uploads are **not** accepted. One of those is false on a page a buyer makes a decision from.
2. **You do not own your output.** Zillatech **retains copyright**. You receive a licence — "exclusive, worldwide, perpetual, sublicensable, royalty-free" for paid outputs — and that licence **terminates on material breach or account termination**. Read plainly: cancel wrongly, lose your rights to your influencer's entire back catalogue.
3. **They train on your work.** They retain a "worldwide, perpetual, royalty-free right" to analyse, train models on, and showcase outputs. Opt-out is buried in the privacy policy.
4. **Billing model is described two different ways.** Marketing says subscription; legal says prepaid tokens.
5. **"Viral Reels Copy" and "Character Swap" are a legal minefield sold as a headline.** Copy any Reel with one click; swap your character onto someone's Instagram screenshot. That is third-party copyrighted material and, in the swap case, potentially a real person's likeness. Marketed as feature #5 and #6.

**None of this is survivable for a client-facing brand tool.** It is, however, a very sharp comparison table for ours.

### 1.7 What Fannabe cannot do

Identical to the July finding for the whole category — **they stop at the download.**

No connected accounts. No scheduling. No autopilot. No approval queue. No verified publish. No analytics. No brand brief. No product ingestion. No spend ledger. No multi-client separation. No autonomy model. No cost accounting.

They make assets. We run accounts. That has not changed and is still the whole thesis.

---

## 2. Where their realism actually comes from

You asked to "upgrade our capabilities to match the ultra realistic aspect." Here is the honest mechanical answer, separated into what is **verified** and what is **inferred**.

### Verified (stated on their site)

Three named post-generation stages, each its own product surface:

| Stage | Their name | Function |
|---|---|---|
| A | **Fix Face** | Facial identity/quality correction after generation |
| B | **AI Skin Enhancer** | "Automatically refines the skin texture and appearance" |
| C | **AI Image Upscale** | Resolution increase without quality loss |

### Inferred (standard practice; not published by them — treat as a hypothesis to test, not fact)

- **Fix Face** ≈ face-region detect → restore/re-inject identity from the pinned master image → blend. This is what makes cross-engine consistency possible without training: the base engine can drift, the face pass pulls it back.
- **Skin Enhancer** ≈ a detail/texture pass that restores pore-level micro-detail the base model smooths away. The "AI glaze" they mock in competitors *is* that smoothing.
- **Upscale** ≈ a detail-adding super-resolution pass, which is where "shot on a real camera" micro-texture is actually manufactured.

### Why this matters more than model choice

The three tells that make an image read as AI — **plastic skin, drifted face, soft/low-detail render** — are each addressed by exactly one of those stages. A better base model reduces all three a little. A post-chain removes them.

**Our pipeline has none of the three.** What we do have is genuinely good and should not be thrown away:

| Ours today | Evidence | Assessment |
|---|---|---|
| Realism register system (front-cam / mirror / propped selfie) | [studio-templates.ts:106](../../personagen-svelte/src/lib/studio-templates.ts#L106), `:897` | **Ahead of them.** They have "Easy Mode themes"; we have a theory of *why* a selfie register reads as authentic |
| Anti-studio prompt scaffolding — "shot on iPhone 15 Pro with ProRAW, 24mm equivalent, natural light… NOT a studio ad or stock photo" | [generate.ts:999](../../personagen-svelte/src/lib/server/content/generate.ts#L999) | Strong, and correctly targeted |
| "Imperfection is quality: slight skin texture visible, natural shadows, lived-in authentic setting — not retouched or plastic-looking" | [generate.ts:1009](../../personagen-svelte/src/lib/server/content/generate.ts#L1009) | **Right instinct, wrong lever.** You cannot prompt a model out of its own smoothing prior. This sentence is doing a job that belongs to stage B |
| 5-stage reference kit (`sheet`, `full_body`, `side_profiles`, `face_closeup`, `feature_grid`), CAS-guarded, restorable | [generate.ts:2656](../../personagen-svelte/src/lib/server/content/generate.ts#L2656) | 🏆 **Better raw material than they have.** We build a richer identity asset and then use less of it |
| Pinned character ref + multi-ref edit (`nano-banana-2/edit`, `multiRef: true`) | [models.ts:100](../../personagen-svelte/src/lib/models.ts#L100) | Correct architecture; single-ref models correctly flagged so consistency doesn't silently degrade |
| Premium base models available | flux-pro/v1.1, nano-banana-2 | Competitive |

**Conclusion: our front half is as good as or better than theirs. We are missing their back half entirely.** That is a far better position to be in than the reverse — the expensive, subtle work is done.

---

## 3. Cross-reference matrix

✅ shipped · ⚠️ partial · ❌ absent · 🏆 clearly ahead

### 3.1 Realism & image craft — **we are behind**

| Capability | Fannabe | PersonaGen | Priority |
|---|---|---|---|
| **Face-fix / identity restoration pass** | ✅ | ❌ *(no match in codebase)* | **P0** |
| **Skin-texture enhancement pass** | ✅ | ❌ prompt sentence only | **P0** |
| **Upscale** | ✅ | ❌ *(only `video.ts:86` "never upscale")* | **P0** |
| Anti-AI-tell prompt scaffolding | ⚠️ implied | 🏆 explicit registers + ProRAW clause | — |
| Multi-stage identity asset | ⚠️ master image | 🏆 5 stages, restorable, CAS-safe | — |
| Cross-engine consistency | ✅ claimed | ⚠️ multi-ref only, degrades on single-ref models | P1 |
| Trained/private identity model | ❌ (they market *not* training as the win) | ❌ | — *(deprioritise — see §5)* |
| Model choice with per-call price shown | ❌ | 🏆 full catalog, tiered, priced in-UI | — |

### 3.2 Creation UX — **was our weakest row; the two blocking gaps closed 09-17**

| Capability | Fannabe | PersonaGen | Priority |
|---|---|---|---|
| Chip trait picker | ✅ 10 ethnicities, 6 age ranges | ✅ **shipped 09-17** — `TraitPicker` in the creation wizard: 8 curated traits, every row defaulting to `Best Fit` | ✅ done |
| Preview → regenerate → **lock** | ✅ | ✅ **shipped 09-17** — `POST /api/persona-preview` renders an agentless portrait, regenerable, adopted as the pinned face at create (gated by `isOwnedBucketUrl`) | ✅ done |
| Time-to-first-face | "under a minute" | unmeasured, unpublished | P0 |
| Easy Mode / preset scenes | ✅ named scenes | ⚠️ studio templates exist, not surfaced as one-click scenes | P1 |
| Prebuilt personas | ✅ | ❌ | P1 |
| **Explore gallery + one-click copy** | ✅ | ❌ | P1 |
| Prompt enhancer | ✅ | ❌ | P1 |
| Image → prompt | ✅ | ❌ | P2 |
| Unique features (vitiligo, heterochromia, scars) | ✅ | ⚠️ free-text advanced fields | P2 |

> **Correction — 2026-09-09, same day.** This table originally read `❌` for
> both reel copy and motion transfer, and §5 below recommended refusing the
> first. **The owner directed that reel copying ship, and it did.** Both
> formats are in the tree: catalog-only `video_v2v` kind, per-second billing off
> a measured clip duration, never-brick fallback to image-to-video. The
> guardrails this document's refusal argument produced were kept and are the
> terms on which it shipped: **no URL ingest — the user uploads a file, we never
> fetch instagram.com on their behalf** — plus an upload-time ownership
> attestation, a per-workspace operator switch, and the AI-disclosure badge. See
> [video-to-video-implementation-plan.md §7b–§7c](video-to-video-implementation-plan.md#7b-decision-2026-09-09--reel-copying-is-in-scope-and-the-phases-invert).

> **Integrity flag — revised 2026-09-17, narrowed but still open.** The 09-11
> landing rework fixed the worst of this. The "regenerate as many times as you
> want" promise is gone, and step 03 now describes the real mechanism — "a
> five-stage reference set locks the face" — which is **true** and is a better
> claim than the one it replaced, because it is ours and checkable.
>
> Two overstatements survived that rework, and **both were closed on 2026-09-17**:
>
> - **Step 01 — "Guided fields with real options… leave the rest on Best Fit — no prompt writing."** Was false: the wizard took ethnicity as a lone free-text input with an `e.g.` placeholder, which *is* prompt writing. **Now true** — `TraitPicker` is the wizard's look input, eight curated traits, every row defaulting to a real `Best Fit` chip.
> - **Step 02 — "Generate the look · 8–30 sec · a photoreal render."** Was false twice over: the wizard rendered nothing, and the 8-second figure was quoting a number nothing measured — `generate-avatar`'s own estimate is "30s–minutes". **Now true** — the wizard renders a real portrait before creation, and the claim reads "30 sec – 2 min".
>
> **Scoping note, recorded because the first estimate was wrong.** This was called
> "wiring, not building". That held for the trait picker; it did not hold for the
> preview. `generate-avatar` is keyed to an existing `agentId`, gated by
> `checkAgentAccess`, and returns 202-and-poll — so the preview needed a new
> agentless endpoint (`/api/persona-preview`) with its own budget and credit
> gates, not a wire-up. It is synchronous because it is one text-to-image call
> rather than the three-image chain, which is the same reasoning that makes
> `source-clip` synchronous.

### 3.3 Content formats — **we are behind on breadth, ahead on depth**

| Capability | Fannabe | PersonaGen | Priority |
|---|---|---|---|
| **Carousel (consistent multi-frame)** | ✅ one click | ❌ | **P1** |
| Trend/reel copy — **from an upload, never a URL** | ✅ | ✅ **shipped 2026-09-09** — `reel-remake` (wan-animate `replace`) | ✅ done — see note below |
| Motion transfer (source clip → persona) | ✅ | ✅ **shipped 2026-09-09** — `motion-transfer` (wan-animate `move`) | ✅ done |
| Character swap onto a screenshot | ✅ | ❌ | ❌ **refuse** (§5) — *unchanged* |
| Talking head / lip-sync | ✅ | ✅ OmniHuman v1.5 @ $0.70 | — |
| Video | ✅ short-form | ✅ Kling O3 5s + 🏆 **multi-shot cinematic director** ([generate.ts:1431](../../personagen-svelte/src/lib/server/content/generate.ts#L1431)) | 🏆 |
| **Hook-quality gate before paying for video** | ❌ | 🏆 threshold 80, adversarial grader ([generate.ts:703](../../personagen-svelte/src/lib/server/content/generate.ts#L703)) | 🏆 |
| Niche-tuned content | ✅ generator | 🏆 brand brief + scraped products | 🏆 |
| Batch generation | ⚠️ | ⚠️ engine-only | P1 |
| Image editor with undo | ✅ | ⚠️ no UI | P2 |

### 3.4 Operations & commerce — **uncontested, both ways**

| Capability | Fannabe | PersonaGen |
|---|---|---|
| Platforms published to | **0** | 🏆 **13** |
| Scheduling / calendar | ❌ | 🏆 Day/Week/Month |
| Autopilot + autonomy levels | ❌ | 🏆 Advisor / Semi / Fully |
| Approval queue | ❌ | 🏆 |
| Verified publish | ❌ | 🏆 |
| Brand brief + product scraping | ❌ | 🏆 |
| Per-persona spend ledger | ❌ | 🏆 |
| Published per-generation cost | ❌ | 🏆 `PRICING_MATRIX` |
| **You own the output** | ❌ they retain copyright | ✅ — **and we don't say so anywhere** |
| Landing page | ✅ | ✅ shipped |
| Pricing page | ⚠️ opaque | ✅ `/billing` |
| Live billing | ✅ | ⚠️ Stripe dormant pending env keys |
| Free tier | ✅ generous, recurring | ⚠️ one-time 1,000-credit welcome |
| **Explore/social proof gallery** | ✅ | ❌ |
| Affiliate program | ✅ | ❌ |
| SEO / comparison articles | ✅ | ❌ |

---

## 4. What to take — ranked

### P0 — the realism chain (this is the whole ask)

> **Status 2026-09-17:** P0.1 **not started** · P0.2 **not started** · **P0.3 DONE** · P0.4 **not started**.
>
> P0.3 landed the same day this revision was written. `TraitPicker` is now the wizard's look input — all eight curated traits as chips, every row defaulting to `Best Fit` — and `POST /api/persona-preview` renders a real portrait for a persona that does not exist yet, regenerable, adopted as the pinned face at creation so it is never paid for twice. Both landing claims (§3.2) are now backed by the product. **The creation-UX row moves 4 → 7**; it is not 9 until pre-made personas and an Explore gallery exist.
>
> That leaves **P0.1 as the sole remaining realism blocker**, and it is now the only thing standing between us and the "ultra realistic" claim. The rest of this list is unchanged.

**P0.1 — Post-generation enhancement pipeline.** Three stages, behind one flag, applied after every persona-bearing image.

```
base generation  →  [face restore]  →  [skin/detail]  →  [upscale]  →  durable store
                         ↑ pinned ugc_character_ref
```

Design constraints that follow from our existing rails:
- Each stage is a **separately priced step** in `PRICING_MATRIX` ([pricing.ts:19](../../personagen-svelte/src/lib/pricing.ts#L19)), metered and debited like any other generation. Under `credits_mode=enforce`, an unmetered stage is a free path — the standing trap named in [the v2 plan](persona-model-v2-action-plan.md).
- Flag through `flags.ts` (env → `platform_settings` → default), not the env-only card-renderer pattern. `UGC_ENHANCE_CHAIN=off|face|face+skin|full`.
- **Never-brick fallback:** any stage that fails returns the previous stage's image. A realism pass must never cost the user a post. This is the same discipline as the card renderer.
- Store the **pre-enhancement original** alongside the final. It is the A/B evidence, and it is the undo.

**Sequence the stages by evidence, not by ambition.** Ship the upscale/detail pass first — it is the cheapest, the least likely to break identity, and it delivers the largest visible jump per dollar. Face restore is the highest-value and highest-risk (a bad blend is worse than no pass), so it ships second with a visible before/after in the UI.

**P0.2 — Prove it or don't ship it.** Build a fixed 20-prompt benchmark set across our realism registers. Generate each with the chain off / partial / full. Judge blind. Publish the grid internally. We have a repo full of assertions about realism and zero measurements — this is the measurement.

**P0.3 — Wire `TraitPicker` into a real creation wizard with preview → regenerate → lock. ✅ SHIPPED 2026-09-17.**

What landed:
- `TraitPicker` is the creation wizard's look input — eight curated traits as chips, every row defaulting to a real `Best Fit` chip. Storage shape unchanged (plain strings), so no prompt builder downstream sees a new format.
- **`POST /api/persona-preview`** — a portrait for a persona that does not exist yet. One synchronous text-to-image call, prompt built by the same `buildHeroPortraitPrompt` the post-creation portrait uses, off a profile put through the same `buildStoredProfile` gate the create route writes with, so the preview cannot drift from what the persona is actually born as.
- Both gates run agentless: `assertWithinBudget` skips only its per-agent daily cap, and the ledger row lands with `agent_id: null`. A regenerate button is exactly the surface that gets abused, so it is billed like any other generation.
- The approved portrait is **adopted** at creation (`characterRef` → `ugc_character_ref`), so the face the user picked is the face the persona keeps and creation does not pay to render a second one.
- Adoption is gated by `isOwnedBucketUrl` — the client supplies that URL, and it is later handed to fal as an `image_urls` entry and re-fetched server-side. That gate had **no test coverage at all** despite its docstring calling it "the ONLY gate"; it now has 18, including a regression test for the substring bypass its original fix never got.

**P0.4 — Publish step timings.** We have fal queue data and show none of it. "Generated in 8s" is a confidence signal that costs nothing.

### P1 — format breadth and cold-start

- **Carousel generator** — consistent outfit/background across N frames. We already hold identity across a 5-stage kit; a carousel is the same problem with a scene lock added. Highest-value format gap.
- **Explore gallery with one-click reuse** — solves "what do I make?", compounds with usage, and gives us the social proof surface we lack entirely.
- **Prompt enhancer** — cheap LLM call, large perceived-quality gain for non-technical users.
- **Prebuilt personas** — instant activation, zero build. Removes the cold-start wall.
- **Easy Mode scenes** — surface the studio templates we already have as named one-click scenes.
- **Cross-engine consistency hardening** — make the single-ref degradation ([models.ts](../../personagen-svelte/src/lib/models.ts) `multiRef: false`) impossible rather than warned.

### P2 — opportunistic

- Image → prompt.
- Editor with undo history (originals already preserved server-side).
- Unique-feature chips (vitiligo, heterochromia, scars) — genuinely good inclusive-representation surface, and it demos well.
- Batch generation in the UI.
- Comparison/SEO pages. Theirs rank; ours don't exist.

---

## 5. What to refuse — and why refusing is the strategy

You asked for high integrity. These are the places where matching Fannabe would cost us the business we are actually building.

| Their feature | Refuse | Reason |
|---|---|---|
| **NSFW / adult studio** | ❌ | It is their moat and it would be our poison. One adult-content incident ends every brand relationship simultaneously. It also forces a high-risk processor, which raises fees and puts Stripe at risk — and Stripe is our billing plan. |
| **Character Swap onto someone's selfie/screenshot** | ❌ | Non-consensual likeness manipulation. There is no version of this a client-facing tool should ship. |
| **"Copy any Reel with one click"** | ⚠️ ~~heavy legal review, or refuse~~ → **OVERRULED 2026-09-09, shipped with guardrails** | Wholesale replication of third-party copyrighted work, sold as a headline. A "trend *format* library" (structure, pacing, hook shape — not the source asset) gets most of the value with none of the exposure. That is the version to build. **The owner decided otherwise the same day and `reel-remake` shipped.** The reasoning above is left standing because it is what the guardrails were built out of: **no URL ingest at all** (the user uploads a clip they chose; we never scrape a platform — the scrape is exposure for *us* and buys nothing the upload doesn't), an ownership attestation recorded on upload, a per-workspace switch so a brand-client account cannot ship a copy by accident, and the AI-disclosure badge. The "trend format library" remains worth building — it is the one asset a competitor cannot copy — but it is no longer the *only* version we ship. |
| **Retaining copyright on customer output** | ❌ | We should go the exact opposite direction and make it loud. |
| **Training on customer outputs by default** | ❌ | Same. |
| **Opaque pricing** | ❌ | We already have a per-generation cost matrix and a spend ledger. This is a fight we win by simply showing up. |

**Turn the refusals into the pitch.** Our answer to their "realism" comparison table is an **integrity** table:

| Them | Us |
|---|---|
| They keep the copyright; you get a licence that dies with your account | **You own every asset. Permanently.** |
| Your outputs train their models by default | **We never train on your work.** |
| Price per generation: unpublished | **Every generation priced before you run it, ledgered after.** |
| Homepage says you can upload a model; terms say you can't | **What the page says is what the product does.** |
| Adult content by design | **Brand-safe by design, with an approval queue that proves it.** |
| Hands you a file | **Runs the account and proves the post landed.** |

That table is defensible, checkable, and it is the wedge you asked for. It only works if row 4 is true of us too — hence P0.3.

---

## 6. Economics

| | Fannabe | PersonaGen |
|---|---|---|
| Entry | Free + recurring monthly credits | Free + **one-time** 1,000-credit welcome |
| Paid range | ~$29–$199/mo | $79 / $299 / $899 |
| Unit | Opaque tokens | **1 credit = 1 retail cent**, 3× markup, published |
| Top-ups | Unnamed packs | $10 / $25 / $50 / $100 with ladder bonuses ([billing-packs.ts:35](../../personagen-svelte/src/lib/billing-packs.ts#L35)) |
| Cost visibility | None | Full `PRICING_MATRIX` |

**Two economic observations.**

1. **Our free tier is structurally weaker than theirs and it is costing us the top of the funnel.** They give recurring monthly credits — "enough to generate a picture post every day" — which keeps a non-paying user in the product long enough to form a habit. Ours is a one-time grant: spend it and the product goes dark. Given that text posts are already free at $0 marginal cost (the ffmpeg card renderer), a small **recurring** monthly media allowance is affordable and would materially change activation.

   **[09-17 — unchanged, and the copy now says so out loud.]** The free row reads "One free credit per person to start" ([plans.ts:36](../../personagen-svelte/src/lib/server/plans.ts#L36)). The wording got more honest; the structure did not move. The `$0` cards batch (up to 100 typographic cards with no model in the run) is a genuine free-tier asset that landed in the interval — but it is text, and the thing a visitor evaluates us on is a face.

2. **The enhancement chain has a real unit cost and must be priced, not absorbed.** Three extra passes per image at a 3× markup is a meaningful per-post increase. The right shape is a **quality tier** the user chooses and sees priced — "Standard / Realistic / Ultra" — mapping to `off / face / full`. That fits the existing model-picker pattern exactly and turns a cost into a product surface. Do not make it silent and do not make it free.

---

## 7. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| ~~Landing page promises a preview/lock loop that doesn't exist~~ | ~~High~~ → **closed 09-17** | P0.3 shipped; the claim is now backed by the product rather than pulled from the page |
| Enhancement chain triples per-image cost, invisibly | High | Price it as a visible quality tier; meter every stage |
| Face-restore pass degrades identity instead of fixing it | Medium | Ship upscale first; before/after in UI; blind benchmark (P0.2) |
| Chasing NSFW revenue "just as an option" | **High** | Settled policy: no. Brand-safe is the product |
| Trend-copy feature invites a takedown | Medium | Build format library, not asset replication |
| Realism work displaces the open monetization loops (engine metering, enforce flip) | Medium | The chain *requires* metering — sequence it after C7, not against it |
| We benchmark against the wrong competitor | Medium | Fannabe is the craft benchmark; **theinfluencer.ai remains the UX/vocabulary benchmark** and this doc does not change that |

---

## 8. Bottom line

**Viability: strong, with one specific and closable deficiency.**

We are building a fundamentally more valuable product than Fannabe. Everything after the image exists — brand grounding, 13-platform verified publishing, autonomy, approval, cost accounting — is uncontested ground that they have not even attempted. Their legal posture is a liability we can attack, their pricing is opaque in a way ours is not, and their core market is one we should decline on purpose.

But they beat us at the moment of evaluation, because the first thing any buyer does is generate one image and look at it. On that single act they win, and they win for a mechanical reason we can fix: **they run three post-processing stages we do not run at all.**

The work, in order:

1. **Ship the enhancement chain** — upscale/detail first, face restore second, metered, flagged, never-bricking, priced as a visible quality tier.
2. **Prove it with a blind benchmark** before believing it.
3. **Wire the trait picker into a real preview → regenerate → lock wizard** — closing the competitive gap and the honesty gap in the same change.
4. **Give the free tier a recurring media allowance** so evaluation doesn't die on day two.
5. **Ship the integrity table** on the landing page — the one thing they structurally cannot answer.

Do those five and we are not competing with Fannabe. We are the platform that generates images as good as theirs *and then actually runs the account*, which is a category they are not in.

### One round deeper — 2026-09-17, after P0.1 shipped

P0.1's upscale stage is committed, hardened and green. Re-reading it against
its own argument rather than its tests turns up five things, and the first two
matter more than the code that was written.

**1. Coverage is 1 call site out of 14.** `enhanceImage` is invoked in exactly
one place — the persona preview portrait. The post pipeline has **13** image
call sites (`generateUgcImage`, `generateProductStill`, `generateGraphicStill`)
and **not one of them is enhanced**. The realism gap this whole document is
about is a gap in the *content a buyer publishes*, and content is still leaving
the building at the base model's raw output. What shipped improves the face a
visitor sees once, in the wizard. Calling P0.1 "done" on that basis would be
the same overstatement §3.2 was written to catch.

**2. P0.2 was skipped, and it is now the gating question — not a formality.**
The chain shipped with **zero evidence it improves realism**. Worse, there is a
specific reason to think the first stage may be the wrong one: ESRGAN is
super-resolution. It sharpens edges and *interpolates* skin, and the failure
mode of that family is a smooth, waxy surface — which is precisely the "AI
glaze" §2 identifies as the tell we are trying to remove. Fannabe's stack names
a **skin enhancer** separately from its upscaler, and §2 reads their realism as
coming from *restored micro-texture*. An upscaler can destroy the very thing
the pass is supposed to add. **Until the blind benchmark runs, "we enhanced it"
is a mechanism, not an improvement**, and it could be a regression.

**3. It has never run.** Not once, against the live endpoint. The schema was
verified from fal's published docs, not from a response. Never-brick means a
wrong assumption degrades to the original rather than breaking a post, so this
fails safe — but "safe" and "working" are different claims and only one of them
is currently supported.

**4. A declared price bounds the bill, never the cost.** `UGC_UPSCALE_USD` is
what we *charge*. If fal bills compute-seconds above that figure, the ledger
under-reports and margin erodes with nothing to notice — the 5.8× LLM-rate
failure with a knob in place of a constant. No drift check exists.

**5. The upscaled portrait becomes the identity anchor.** The wizard adopts the
*enhanced* image as `ugc_character_ref`, so it is the reference every later
generation is conditioned on. If the upscaler alters bone structure, eye shape
or skin even slightly, it moves the one asset whose entire job is to hold still
— and it moves it before the five-stage kit is built on top. This is the
highest-consequence item on the list and the least obvious.

**What this changes about the ordering.** P0.2 stops being a verification step
after P0.1 and becomes a precondition for extending it: benchmark first, then
decide whether upscale is even the right first stage, then wire the remaining
13 call sites. Wiring them now would multiply an unproven pass across every
image the product makes.

---

### Three rounds deeper — 2026-09-17, the wrong endpoint

The previous round closed the anchor risk and made the schema gaps visible.
This round found something upstream of all of it: **the module defaulted to
an endpoint the repo's own research said to refuse, written the same day and
never read.**

[`realism-chain-feasibility-2026-09-09.md`](realism-chain-feasibility-2026-09-09.md)
ran 11 live calls against fal and is unambiguous: `esrgan` bills per
compute-second, "has no measurable ceiling," and its own risk table calls
that **High severity** with the mitigation *"do not wire any of them,
however attractive esrgan's face:true is."* Every hardening this document
recorded for the price-drift finding — `measuredUsd: null`, the caveat that
drift accountability is "structurally unmeasurable for this endpoint" — was
a correct response to a real gap, but the gap existed only because of which
endpoint got picked.

**Fixed by swapping the model, not by hardening around it further.**
`fal-ai/seedvr/upscale/image`, verified against fal's live schema: same
`image_url` in / `image.url` out shape (the queue-polling fallback added
last round needed no change), confirmed non-generative, aspect preserved to
~1.3% in live testing, and — the point — billed **per output megapixel**, a
number a human can look up and quote, rather than a compute-second charge
with no ceiling before the call runs. `.env.example` now carries a real
starting price (~$0.001/MP, ~$0.004 for a typical 4MP portrait) instead of a
blank the operator had nothing to base a number on.

**Read the feasibility doc's §6 before wiring stages 2 and 3.** It disagrees
with this document's own ordering logic in one place worth flagging: it
confirms upscale-first is right on *risk and cost*, but finds the
"largest visible jump per dollar" claim **unsupported** — plastic skin is a
stage-B (skin/detail) problem, and enlarging pixels cannot fix it. Do not
expect the benchmark below to show a dramatic win; expect it to prove the
rail is safe before the skin stage, which is where the real jump is and
where the real identity risk also lives.

**The branch this is landing on is being edited by dozens of concurrent
sessions**, several of them on `personagendemo` specifically at the time of
this round. `docs/audit/state-reassessment-2026-09-17.md` already tracks
that hazard in far more depth than this document should — a `MERGE_HEAD`
left pending across tool calls got consumed by a peer's commit earlier
today, and a shared-tree run of `deploy.ps1` has no branch check and would
push an unrelated `main` while gating against this branch. **That document
is now the canonical source for branch/process risk; this one defers to it**
rather than re-describing what it already measured better, with session
transcripts this document has no access to.

---

### Two rounds deeper — 2026-09-17, acting on the five findings

The previous section listed five findings. This round closes what can be
closed, makes the rest measurable rather than asserted, and turns up two new
things — one of them about how this branch is being worked, not about the code.

**Closed.**

| Finding | What happened |
|---|---|
| 5. The upscaled portrait became the identity anchor | **Closed.** The wizard now anchors `ugc_character_ref` to the base model's own output and shows the enhanced one on screen. Until the benchmark proves the pass does not move a face, an unproven pass is not what the five-stage kit gets built on. |
| 3. Never run live; schema from docs | **Narrowed.** fal's machine-readable OpenAPI was fetched. `scale` allows 1–8 (we cap at 4, now stated as a choice). The schema documents *only* the queue host, where POST returns a `QueueStatus` — the sync host production relies on is documented nowhere. The module now handles both shapes, polls inside the same budget, and cancels what it cannot wait for. Still zero live calls. |
| 4. Declared price bounds the bill, not the cost | **Cannot be closed for this endpoint — made visible instead.** The schema declares no cost, usage or billing field anywhere. `measuredUsd` is now an explicit `null` so `price_table_drift` shows the row as *unmeasured* rather than letting the declared rate pass for truth. **If drift accountability matters — and this repo says it does — "reports its cost" belongs in the criteria for choosing the upscaler**, not just quality. |
| 2. P0.2 skipped | **Harness exists; unrun.** `enhance.benchmark.test.ts`: one portrait per realism register, the pass run over each, pairs written *shuffled* with the answer key in a separate file. Live-money, so it is an integration test gated on `ENHANCE_BENCHMARK=1` plus a key, touching no server, ledger, bucket or persona. It asserts the harness worked, not a winner. **Its own first version could not make a pair** — persistence on a fal URL threw and never-bricked to the original for every register, which would have looked like a run while measuring nothing. Caught by re-reading before commit. |
| 1. Coverage is 1 of 14 | **Held on purpose.** Unchanged until the benchmark says the first stage is the right one. |

**New, and the one that matters most is not about the code.**

**A. The branch is shared by dozens of concurrent sessions.** This document
recorded one sweep incident when it looked like an isolated event; it was
not — see the *Three rounds deeper* correction above, which points to
[state-reassessment-2026-09-17.md](../audit/state-reassessment-2026-09-17.md)
as the canonical, better-sourced account (git history plus session
transcripts). Read that document for the branch/process risk, including the
`deploy.ps1` finding that matters more than anything in this file: it has no
branch check and would push an unrelated `main` if run from here.

**B. The benchmark's judge is a person, and the loop cannot close from
here.** Running it costs about a dollar and five minutes of looking; it needs
a fal key and a human deciding which of two faces reads as real. That is not
something to automate — encoding the answer would be skipping the benchmark —
so it is the one item on this list that only the owner can move:

```
cd personagen-svelte && ENHANCE_BENCHMARK=1 npm run test:integration -- enhance.benchmark
```

then score `portfolio/enhance-benchmark/<run>/` before opening the key.
If *upscaled* does not win clearly across registers, the first stage should be
a skin/detail pass, not super-resolution, and the other thirteen call sites
should wait for that.

---

### Re-measured verdict — 2026-09-17

**Viability: strong, and the deficiency is now more isolated than it was.**

Eight days of work closed the format-breadth gap outright (16 formats, parity reached), widened the accounting lead, and shipped video-to-video on the exact guardrails §5 argued for — upload-only, attested, operator-gated. That is a good interval, and the reel-copy decision in §3.2 shows the refusal argument doing its proper job: not blocking the feature, but setting the terms it shipped on.

Item 3 then shipped on 09-17 — the trait chips and the pre-creation preview, described in §4. Items 1, 2 and 4 remain open.

**That halves the first-ninety-seconds problem and isolates what is left.** A visitor now picks traits from chips and looks at a real face before committing to anything, which is the half of the gap that was pure interface. What remains is not interface: they get three post-processing passes and we still get the base model's raw output. Everything downstream of those ninety seconds we already win, and won by more this week than last.

So the ordering collapses to one item. **P0.1 is now the only thing between us and the claim in Fannabe's own headline.** It is the real engineering — a face-restore, a skin/detail pass and an upscale, each priced, metered and never-bricking — and it decides whether "ultra realistic" is something we can say about our own output or something we are still borrowing from their marketing.

---

## Sources

- [Fannabe — AI Influencer Generator](https://www.fannabe.com/)
- [Fannabe — Best AI Influencer Generators 2026](https://www.fannabe.com/articles/best-ai-influencer-generators)
- [Fannabe — Higgsfield vs Fannabe](https://www.fannabe.com/articles/higgsfield-vs-fannabe)
- [Clout AI — Fannabe AI Review (2026): Features, Rights and Limits](https://www.tryclout.ai/blog/fannabe-ai-review)
- [StartupHub.ai — Fannabe Review 2026](https://www.startuphub.ai/ai-news/ai-tools/2026/fannabe-review-2026-is-it-worth-it-features-pricing-and-honest-verdict)
- [Shyft — Fannabe pricing, features, review](https://shyft.ai/tools/fannabe)
- [There's An AI For That — Fannabe](https://theresanaiforthat.com/ai/fannabe/)
