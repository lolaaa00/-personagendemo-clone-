# Can we compete on quality, configs, variations and types? — the verdict

**Date:** 2026-09-09
**Question asked:** can PersonaGen compete with Fannabe and its peers on **quality, configs, variations, and types of generation** — and are we missing anything?

**Inputs, all produced today, all evidence-based:**
- [our-generation-surface-2026-09-09.md](our-generation-surface-2026-09-09.md) — an audit of what our code actually exposes
- [generation-surface-scan-2026-09-09.md](generation-surface-scan-2026-09-09.md) — a scan of eight competitors' live surfaces
- [realism-chain-feasibility-2026-09-09.md](realism-chain-feasibility-2026-09-09.md) — verified endpoints and prices for the missing quality chain
- [fannabe-viability-assessment-2026-09-09.md](fannabe-viability-assessment-2026-09-09.md) — this morning's teardown, now partly superseded

This document supersedes the priority ordering in all of the above.

---

## 0. The verdict

**On types: at parity.** Today's work took us from 6 to 11 formats, including both of Fannabe's headline features and one nobody else advertises (a listicle with speech-timed reveals). This is no longer where we lose.

**On quality: absent, not weak.** Searches for upscale, face-restore, denoise, sharpen, inpaint, rembg, second-pass and colour-grade return **zero code hits**. The only ffmpeg touching image quality is a CRF-27 downscale for bandwidth — it can only make output worse. Competitors ship a parameterised toolchain here, and a whole product category (Enhancor, Rasgo, PykASO) exists to sell it standalone.

**On configs: deep but disconnected, AND thin where it counts.** Both halves are true and they need different fixes.

**On variations: `num_images: 1` is hardcoded on every image path.** We generate exactly one image, ever. Competitors do 10–32 per prompt.

**And the strategic finding nobody asked for:** the operations moat we have been planning around is eroding. Higgsfield now schedules content, shows credit cost per piece **before** generating, waits for approval, runs recurring jobs, and publishes to TikTok. Three rows our own assessments call "uncontested" have a competitor in them.

---

## 1. Corrections to earlier assessments

Stated plainly, because acting on the old versions would waste money.

| Earlier claim | Status | What is actually true |
|---|---|---|
| "Ship upscale first — face restore is the highest risk stage" | **WRONG** | Codeformer is **face-region-only** with an explicit `fidelity` knob. Every *skin* candidate is a whole-frame diffusion edit (guidance 3.5, 30 steps) that re-renders the face as collateral. **Stage B is the identity risk, not stage A.** |
| "Upscale delivers the largest visible jump per dollar" | **UNSUPPORTED** | Enlarging pixels cannot remove plastic skin. Upscale-first is still right — on **risk and cost** grounds, not visible-jump grounds. |
| "Distribution, scheduling, approval and cost transparency are uncontested" | **NO LONGER TRUE** | Higgsfield Supercomputer + CronJobs + `tiktok_publish`; Creatify and Argil publish full per-endpoint credit tables. |
| "Nobody publishes per-generation costs" | **FALSE** | We still win on retail-cent honesty and the per-persona ledger. The category claim is dead. |
| "Build a trend *format* library as the safe alternative to reel-copying" | **ALREADY SHIPPED ELSEWHERE** | theinfluencer.ai analyses any Instagram account for its **breakout** reels (ones beating that creator's own baseline), browsable, 1-click recreate, ≤6 shots, ~2 min. |
| "Trained identity needs 20+ photos; two of three competitors have it" | **STALE** | Seven vendors. The bar fell to **one photo** (Argil, HeyGen). |
| Fannabe "markets no-training as the win" | **Self-contradicting** | Its own comparison article lists LoRAs in its dashboard, and its motion control is "paste Instagram links" — the exact URL ingest we refused. |

---

## 2. Configs — the two different problems

### 2a. Deep but disconnected (a wiring job)

The persona contract v2 is **orphaned**: ~90 schema leaves, a 15-stage seeded sampler, 360 curated names, 23 weighted trait tables, `look-prompt.ts` and a 672-line `brief-constraints.ts` — with **zero production callers**. It is written on save, then `downgradeV2toV1` strips every v2-only leaf before generation reads it. `personaBackboneEmits()` has no call site outside an admin readout.

The trait depth competitors sell as a headline **already exists here and is not plugged in.**

Also built and unreachable:
- `batch_generate` — up to 12 budget-gated copies, **zero UI callers**
- `refineUgcMedia` implements **11 inputs; the route forwards 2**
- `PROPPED_LOOK`, a fully-written realism register, unused

### 2b. Genuinely thin (a build job)

Per-generation config is not merely disconnected — it does not exist:

| Axis | Competitors | Us |
|---|---|---|
| Camera vocabulary | ~56–70 named moves (Higgsfield) | none |
| Presets | 986 Marketing Studio · 64 i2v · 53 templates | 41 Studio templates |
| Language | 75 enums (Creatify) | none |
| Caption styles / fonts | 38 / 41 | one burned style |
| Aspect ratio | exposed | **hardcoded `9:16`** |
| Resolution · negative prompt · cfg · seed | exposed | none |

### 2c. Four controls that are false promises

Same class as a landing page selling a flow that doesn't exist — worse, because these are *in the product*:

1. **Card Palette is dead.** `ink/warm/cool/mono` are offered; `cardGroundOverride` accepts only hex and returns null for all four.
2. **"Third person" framing sends an empty string** while `PROPPED_LOOK` sits unused.
3. **`ugc_video_quality`** (`mvp|premium`) is a migrated column, read into config, consumed by **no branch**.
4. **`neverDiscusses`** — a per-persona brand-safety denylist — is **stored and never enforced anywhere.** For a product whose pitch is brand-safe client accounts, this is a hole, not a dead knob.

---

## 3. The realism chain — verified, cheap, and not what we assumed

All three endpoints verified live (HTTP 200, real images returned). Assessment spend: ~$0.175 across 11 calls.

```
still → fal-ai/codeformer            (fidelity 0.5, upscale_factor 1)   ← face, region-only, LOW risk
      → fal-ai/image-editing/realism (lora_scale 0.4)                    ← skin, whole-frame, HIGH risk
      → fal-ai/seedvr/upscale/image  (factor 2)                          ← detail
```

| Tier | Provider USD | Credits | Δ on the still | Δ on a spokesperson post | Latency |
|---|---|---|---|---|---|
| ffmpeg only | $0.0000 | 0 | — | — | ~0s |
| codeformer + seedvr | $0.0061 | 2 | +8% | +0.8% | ~17s |
| **full chain** | **$0.0461** | **14** | **+58%** | **+5.7%** | ~25s |

**87% of the chain's cost is the single skin stage** — which is also the identity-risk stage. That makes `codeformer + seedvr` the obvious default and skin an opt-in "Ultra" tier.

**No migration is required** — confirmed three ways: new `ModelKind`s stay out of the DB via `isRegistryKind`; `platform_setting_set()` validates only three keys by name; `generation_events.operation` is bare `TEXT` with no CHECK.

### Traps found by verification, not by reading docs

- **`image-editing/retouch` and `retoucher` SMOOTH skin.** That is the glaze we are trying to remove. Only `image-editing/realism` adds detail.
- **`adapterFromProbe` returns null for all of them** — they are prompt-less, and it bails on `!probe.textParam`. The Model Manager swap path structurally refuses them; these must be hand-written catalog entries.
- **Output shape mismatch:** `generate.ts` reads `data.images?.[0]?.url` at **11 sites** and never the singular `{image:{url}}` that seedvr, codeformer, recraft, bria and topaz return.
- **A `per_megapixel` Billing member is needed** (6 candidates use it; `parsePriceText` already parses it). Compute-second endpoints (`esrgan`, `aura-sr`, `ccsr`, `retoucher`) are **unquotable — refuse to wire them**, despite `esrgan`'s attractive `face:true`.
- **Aspect drift:** `face-enhancement` turned 800×450 into 1392×752 (4% change) — a platform-crop hazard. seedvr and realism preserve aspect.
- **A $0 local pass exists:** ffmpeg 8.1 on this host has `cas`, `unsharp`, `noise` and lanczos, verified end to end. No `sr` filter, so no local super-resolution and no local face restore.

---

## 4. What to do, in order

**Tier 1 — connect what is already built.** Cheapest depth we will ever buy.
1. Persona contract v2 into the prompt path (stop `downgradeV2toV1` eating it before generation).
2. **Enforce `neverDiscusses`** — safety, not parity.
3. `batch_generate` to a UI; unhardcode `num_images`.
4. **Pass a seed to every media model** and expose reroll. Almost nobody in the category exposes seeds; combined with our cost ledger it makes *"that one again, slightly different"* possible — a genuinely open axis.
5. Refine's 9 orphaned inputs.
6. Kill the four false promises (§2c).

**Tier 2 — the realism chain.** `codeformer + seedvr` as default (+2 credits, +0.8% on a post), skin as an opt-in tier. Metered per stage, flagged, never-brick, with the pre-enhancement original stored as the A/B evidence and the undo. **Prove it with a blind benchmark before believing it.**

**Tier 3 — the evaluation loop.** Preview → regenerate → **lock**. Our landing page already sells this as steps 2 and 3 and the product does not do it. This closes a competitive gap and an honesty gap in one change.

**Tier 4 — format breadth.** Carousel first (sharpest single gap, on two competitors), then aspect-ratio/resolution exposure, then camera vocabulary.

**Not now:** trained identity. The bar collapsed to one photo, seven vendors have it, and it is a much larger build than everything above.

---

## 5. What to keep refusing

- **NSFW/adult.** Their moat, our poison: one incident ends every brand relationship simultaneously, and it forces a high-risk processor that puts Stripe at risk.
- **Character swap onto a third party's selfie or screenshot.**
- **URL ingest.** Fannabe's motion control is "paste Instagram links". Ours takes an upload with a recorded attestation. That difference is the product.
- **Compute-second priced endpoints**, which cannot be quoted before a run.

---

## 6. Bottom line

We are **not** behind on what we can make. We are behind on **how good each one looks**, on **how much a user can steer it**, and on **how many they can see before choosing**.

The cheapest fixes are also the largest: a deep trait system, a batch path and a refine surface are already written and simply not connected. The realism chain is verified, costs +0.8% on a post at the safe tier, and needs no migration.

The uncomfortable part is §1: the operations lead we have been treating as a moat is now contested. That argues for spending the next cycle on the artifact — the thing a buyer judges in the first thirty seconds — rather than on more of the operations layer.
