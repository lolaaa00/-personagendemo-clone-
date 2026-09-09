# The realism chain — feasibility, verified

**Date:** 2026-09-09
**Question:** what would it actually take to build the three post-generation stages that [the Fannabe teardown](fannabe-viability-assessment-2026-09-09.md) ranked P0 — `Fix Face` → `AI Skin Enhancer` → `AI Image Upscale` — and which of them is worth building first?
**Method:** every provider claim below was fetched live from fal's OpenAPI spec and its rendered pricing on 2026-09-09. Seven endpoints were additionally *run* against the live API with the key in `personagen-svelte/.env`. Nothing here is from memory.
**Balance check:** the fal balance is **not** exhausted — `fal-ai/esrgan` returned HTTP 200 with an image on the first attempt. Total spend for this assessment: **under $0.20** (11 successful calls, itemised in §8).

---

## 0. The four findings that change the plan

1. **The cheap rung is far cheaper than the assessment assumed.** A verified, aspect-preserving 2× super-resolution pass costs **$0.0015** and takes **1.5 seconds** ([`fal-ai/seedvr/upscale/image`](https://fal.ai/models/fal-ai/seedvr/upscale/image), measured). That is 2 % of the base still's cost. "Ship upscale first" is not a compromise; it is nearly free.
2. **The assessment's risk ordering is backwards.** It says face restore is the highest-risk stage and the skin pass ships earlier. The specs say the opposite: `fal-ai/codeformer` is **face-region-only with an explicit identity/quality knob** (`fidelity`, default 0.5), whereas every skin/detail candidate is a **whole-frame diffusion edit** (`guidance_scale` 3.5, `num_inference_steps` 30, `lora_scale` 0.6) that re-renders the face along with everything else. **Stage B is the identity risk, not stage A.**
3. **Two of the three obvious "skin" endpoints do the wrong thing.** `fal-ai/image-editing/retouch` and `fal-ai/retoucher` both *smooth* skin and remove blemishes — which is the AI-glaze tell the teardown wants removed, applied deliberately. The endpoint that adds detail is `fal-ai/image-editing/realism` ("Add details to faces, enhance face features, remove blur").
4. **None of these models can be auto-adapted.** `adapterFromProbe` returns `null` on its first line for any endpoint with no text parameter, and every enhancement endpoint verified below is prompt-less. They must ship as hand-written catalog entries. Because they need **new `ModelKind`s that are not `RegistryKind`s**, that route requires **no database migration** — the `talking_head` / `llm` precedent applies exactly. See §5.

---

## 1. Stage C — upscale / detail

All specs fetched from `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<id>`. Prices are the rendered figure on each model's fal page.

| Endpoint | Required input | Optional inputs that matter | Output | Price | Basis | Notes |
|---|---|---|---|---|---|---|
| [`fal-ai/seedvr/upscale/image`](https://fal.ai/models/fal-ai/seedvr/upscale/image) | `image_url` | `upscale_factor` (2), `upscale_mode` (`factor`\|`target`), `target_resolution`, `noise_scale` (0.1), `output_format` (`jpg`) | `{image:{url,width,height}}` | **$0.001 / MP** | per megapixel | **Measured live:** 800×450 → 1600×912 in **1.49 s**, cost ≈ $0.0015. Aspect 1.778 → 1.754 (rounds to a multiple of 16). Non-generative. **The recommended default.** |
| [`fal-ai/recraft/upscale/crisp`](https://fal.ai/models/fal-ai/recraft/upscale/crisp) | `image_url` | `sync_mode`, `enable_safety_checker` — that is the whole API | `{image:{url}}` (no dims returned) | **$0.004 / image** | per call | **Measured live:** 200 in **9.9 s**, returns `.webp`. Zero knobs, so zero drift risk — and zero control. Flat price makes it the easiest to quote. |
| [`bria/increase-resolution`](https://fal.ai/models/bria/increase-resolution) | `image_url` | `desired_increase` (2\|4), `preserve_alpha`, `preserve_color` | `{image:{url}}` | **$0.04 / image** | per call | Catalog text: "Preserves the original content — no hallucination." Licensed-data model; the safest legal posture, 10× the price of seedvr. |
| [`fal-ai/drct-super-resolution`](https://fal.ai/models/fal-ai/drct-super-resolution) | `image_url` | — | image | **$0.0045 / MP** | per megapixel | Classical SR, no creativity term. |
| [`fal-ai/esrgan`](https://fal.ai/models/fal-ai/esrgan) | `image_url` | `model` (6 RealESRGAN variants), `scale` (2), **`face` (bool)**, `tile`, `output_format` | `{image:{url,width,height}}` | **$0.00111 / compute second** | *no supported basis* | **Measured live:** 200, 400×225 → 800×450 with `face:true`. The `face` flag runs a face-restoration pass **in the same call** — one call could serve stages A and C. But compute-second billing cannot be quoted before the run (see §5.2). |
| [`fal-ai/clarity-upscaler`](https://fal.ai/models/fal-ai/clarity-upscaler) | `image_url` | `prompt` (default "masterpiece, best quality, highres"), **`creativity` (0.35)**, `resemblance` (0.6), `upscale_factor` (2), `num_inference_steps` (18), `negative_prompt` | `{image:{url},timings,seed}` | **$0.03 / MP** | per megapixel | **Trap.** `creativity: 0.35` by default means it *invents* detail — including on the face. 30× seedvr's price with an identity-drift default. Only candidate with a `prompt`, so also the only one `adapterFromProbe` would accept — a coincidence, not a recommendation. |
| [`fal-ai/recraft/upscale/creative`](https://fal.ai/models/fal-ai/recraft/upscale/creative) | `image_url` | same two as crisp | `{image:{url}}` | **$0.25 / image** | per call | 62× crisp. Generative. |
| [`fal-ai/flux-vision-upscaler`](https://fal.ai/models/fal-ai/flux-vision-upscaler) | `image_url` | — | image | **$0.10 / MP** | per megapixel | ~$0.40 on a 4 MP output. Generative. |
| [`fal-ai/ideogram/upscale`](https://fal.ai/models/fal-ai/ideogram/upscale) | `image_url` | `detail` (50), `resemblance` (50), `prompt`, `expand_prompt` | `{images:[…],seed}` | **$0.06 / image** | per call | Note the **plural** output shape. |
| [`topaz/upscale/image/precision`](https://fal.ai/models/topaz/upscale/image/precision) | `image_url` | `upscale_factor` (2), `model` (6 Gigapixel variants), **`face_enhancement` (true)**, `face_enhancement_strength` (0.8), `face_enhancement_creativity` (0), `denoise`, `sharpen`, `fix_compression` | `{image:{url}}` | **$0.08 per started 24 MP of output** | per-MP, banded | Serves **stages A and C in one call** with an explicit face-creativity term pinned at 0. A 4 MP output falls in the first band → a flat **$0.08**. Same price as the whole base still. |
| [`clarityai/crystal-upscaler`](https://fal.ai/models/clarityai/crystal-upscaler) | `image_url` | `creativity` (0), `scale_factor` (2), `output_format` | `{images:[…]}` | **$0.016 / MP** | per megapixel | Portrait/face-optimised SR with creativity defaulted to 0 — the honest middle between seedvr and a generative pass. Overlaps stage B by design. |
| `fal-ai/aura-sr`, `fal-ai/ccsr`, `fal-ai/creative-upscaler` | `image_url` | — | image | **unpublished** (page renders "$0 per compute second") | — | Legacy GPU-second models with no published rate. **Unquotable — do not wire.** |

---

## 2. Stage A — face restoration / identity fix

| Endpoint | Required input | Optional inputs that matter | Output | Price | Basis | Notes |
|---|---|---|---|---|---|---|
| [`fal-ai/codeformer`](https://fal.ai/models/fal-ai/codeformer) | `image_url` | **`fidelity` (0.5)**, `upscale_factor` (2), `face_upscale` (true), `only_center_face` (false), `aligned`, `seed` | `{image:{url,width,height},seed}` | **$0.0021 / MP** | per megapixel | **Measured live:** 200 in **15.9 s**, 400×225 → 1820×1024. `fidelity` is the identity↔quality dial — the single most important control in this document, because it is the only published knob that directly bounds identity drift. Also performs the upscale, so **it can serve stages A and C alone**. |
| [`fal-ai/image-editing/face-enhancement`](https://fal.ai/models/fal-ai/image-editing/face-enhancement) | `image_url` | `guidance_scale` (3.5), `num_inference_steps` (30), `aspect_ratio`, `safety_tolerance`, `output_format` | `{images:[{url,width,height}],seed}` | **$0.04 / image** | per call | **Measured live:** 200 in **10.8 s**, 800×450 → **1392×752**. That is an aspect change from 1.778 to 1.851 — a **4 % drift**, a real platform-crop hazard on a 9:16 cover. Whole-frame diffusion edit. |
| [`fal-ai/phota/enhance`](https://fal.ai/models/fal-ai/phota/enhance) | `image_url` | `profile_ids` (array), `num_images`, `output_format` | `{images:[…]}` | **$0.13 / image** | per call | Markets itself as identity-preserving. `profile_ids` implies an enrolled-identity concept we have no account for. 62× codeformer. |
| [`fal-ai/image-apps-v2/portrait-enhance`](https://fal.ai/models/fal-ai/image-apps-v2/portrait-enhance) | `image_url` | `aspect_ratio` | `{images:[…]}` | **$0.40 / image** | per call | **5× the base still.** Ruled out on price alone. |
| `topaz/upscale/image/precision` | see §1 | `face_enhancement_strength`, `face_enhancement_creativity` | `{image:{url}}` | $0.08 banded | per-MP banded | The one-call A+C alternative to codeformer, at ~10× the price and with a real vendor behind it. |

**On "restore identity from the pinned reference":** *no fal endpoint verified here does that.* Every candidate is a blind restorer — it sharpens whatever face is in the frame; it cannot pull the face back toward `ugc_character_ref`. Reference-conditioned identity injection would mean a face-swap model (a different risk and policy conversation) or an `image_edit` re-pass through `nano-banana-2/edit` with the pinned kit, which costs $0.08 and re-renders the whole frame. **The teardown's inferred mechanism for `Fix Face` — "re-inject identity from the pinned master image" — is not what any of these endpoints do.** Treat that inference as unconfirmed.

---

## 3. Stage B — skin / texture

| Endpoint | Required input | Optional inputs that matter | Output | Price | Basis | Direction |
|---|---|---|---|---|---|---|
| [`fal-ai/image-editing/realism`](https://fal.ai/models/fal-ai/image-editing/realism) | `image_url` | `guidance_scale` (3.5), `num_inference_steps` (30), **`lora_scale` (0.6)**, `enable_safety_checker`, `seed` | `{images:[{url,width,height}],seed}` | **$0.04 / image** | per call | ✅ **Adds detail.** Catalog: "Add details to faces, enhance face features, remove blur." **Measured live twice:** 512×512 → 512×512 (7.6 s) and 800×450 → **800×448** — resolution and aspect preserved. Rejects inputs under 256×256 (`image_too_small`). `lora_scale` is the strength dial. **The only correct-direction candidate.** |
| [`fal-ai/image-editing/retouch`](https://fal.ai/models/fal-ai/image-editing/retouch) | `image_url` | same shape, `lora_scale` (1.0) | `{images:[…],seed}` | $0.04 / image | per call | ❌ **Wrong direction.** "Remove blemishes and improve the skin" = smoothing. This *is* the glaze. |
| [`fal-ai/retoucher`](https://fal.ai/models/fal-ai/retoucher) | `image_url` | `seed` only | `{image:{url},seed}` | unpublished | compute-second | ❌ Wrong direction *and* unquotable: "smooth skin and remove blemishes". |
| `clarityai/crystal-upscaler` | see §1 | `creativity` (0) | `{images:[…]}` | $0.016 / MP | per megapixel | **Overlaps stage C.** Portrait-optimised SR *is* a texture pass — the one endpoint that legitimately collapses B and C into one call, at ~$0.06 for a 4 MP output. |

**Does stage B overlap stage C?** Yes, materially. A super-resolution model reconstructs high-frequency detail, which is pore-level texture; a "skin detail" LoRA re-renders the frame with a detail bias. The distinct thing stage C does that stage B does not is **increase pixel count**; the distinct thing stage B does is **add information that was never in the frame**. A chain that runs both pays twice for one perceptual effect unless the upscaler is non-generative — which is exactly why the recommended chain pairs a *non-generative* upscaler with a *generative* detail pass, and never two generative passes.

---

## 4. Can any stage run locally on ffmpeg?

**Partly — and it is worth having, but it is not stage B.** Verified on this host (`ffmpeg 8.1-full_build`, filters enumerated with `ffmpeg -filters`):

| Wanted | ffmpeg filter | Present here | Verdict |
|---|---|---|---|
| Enlarge | `scale=iw*2:ih*2:flags=lanczos` | ✅ | Works, adds no information |
| Local contrast / perceived sharpness | `cas` (Contrast Adaptive Sharpen), `unsharp` | ✅ both | Genuinely improves the "soft render" tell |
| Micro-texture over plastic skin | `noise=alls=6:allf=t+u` | ✅ | Real, if crude. Grain reads as camera sensor noise, one of the three tells |
| True super-resolution | `sr` (DNN, ESPCN/SRCNN) | ❌ **absent** — needs a libtensorflow build | Not available |
| Face restoration | — | ❌ no such filter exists | Impossible locally |

**Verified end to end:** `ffmpeg -i in.png -vf "scale=iw*2:ih*2:flags=lanczos,cas=strength=0.35,noise=alls=6:allf=t+u" out.png` ran clean on the 800×450 test asset and produced a 1600×900 PNG. Cost **$0**, latency effectively zero.

This slots into the existing `HostCapability: 'ffmpeg'` rail at [formats.ts:75](../../personagen-svelte/src/lib/formats.ts#L75) with no new capability, and mirrors the $0 card renderer's posture exactly. It is the right **free tier** of the quality ladder and the right **never-brick fallback** when a paid stage fails — but it is not a substitute for a model pass, because it cannot add information the base model never generated.

---

## 5. Integration points in this codebase

### 5.1 Does it need a migration? **No.**

Three separate checks, all negative:

| Thing being added | Where a constraint would bite | Verified |
|---|---|---|
| New `ModelKind`s (`image_upscale`, `image_face`, `image_detail`) | `model_registry.kind` CHECK constraint | **Not hit.** `REGISTRY_KINDS = ['image_t2i','image_edit','video_i2v','tts']` ([model-registry.ts:44](../../personagen-svelte/src/lib/server/model-registry.ts#L44)). `isRegistryKind` gates the seed ([:309](../../personagen-svelte/src/lib/server/model-registry.ts#L309)), `effectiveOptions` ([:424](../../personagen-svelte/src/lib/server/model-registry.ts#L424)) and `effectiveResolve` ([:449](../../personagen-svelte/src/lib/server/model-registry.ts#L449)) — a non-registry kind never reaches the database and resolves statically. This is the documented `talking_head` / `llm` pattern, in the module's own words: *"which is why the new stages ship with no migration."* |
| New operator switch `enhance_chain` | `platform_setting_set()` validation | **Not hit.** The function validates only `credits_mode`, `activity_log` and `activity_pepper` by name ([platform_settings_migration.sql:57–63](../../personagen-svelte/supabase/platform_settings_migration.sql)); any other key is accepted. Confirmed by precedent: `grep -rn persona_backbone --include=*.sql` returns **nothing** — both Persona v2 switches shipped code-only. The change is `PlatformSettings` + `DEFAULT_SETTINGS` + `SETTING_KEYS` + a `coerce()` case in [settings.ts](../../personagen-svelte/src/lib/server/settings.ts), plus a reader in [flags.ts](../../personagen-svelte/src/lib/server/flags.ts). |
| New ledger operation `enhance` | `generation_events.operation` | **Not hit.** Column is a bare `TEXT NOT NULL` with no CHECK ([generation_events_migration.sql:11](../../personagen-svelte/supabase/generation_events_migration.sql)). Only `OPERATION_LABELS` in [pricing.ts](../../personagen-svelte/src/lib/pricing.ts) needs a row, and that is client-side. |

### 5.2 The basis problem — the one type change with teeth

| Basis found in the wild | Already supported? | Verdict |
|---|---|---|
| per call / per image (`recraft/*`, `bria/*`, `image-editing/*`, `ideogram`, `phota`, `portrait-enhance`) | ✅ `per_call` | Nothing to do |
| **per megapixel** (`seedvr`, `codeformer`, `drct`, `clarity-upscaler`, `crystal`, `flux-vision`) | ❌ | **New `Billing` member required** |
| per **started N** megapixels, banded (`topaz/*`) | ❌ | A ceiling-division variant of the above |
| per **compute second** (`esrgan`, `aura-sr`, `ccsr`, `retoucher`) | ❌, and unknowable before the run | **Refuse to wire.** A quote must be an upper bound on the bill — [formats.ts:614](../../personagen-svelte/src/lib/formats.ts#L614) makes that explicit for `per_second`. Compute-second has no measurable ceiling. This is why seedvr beats `esrgan` despite `esrgan`'s attractive `face:true`. |

Adding `per_megapixel` to `Billing` in [models.ts](../../personagen-svelte/src/lib/models.ts) forces exactly three compile errors, all of them the ones you want:

- `UNIT_NOUN: Record<Billing, string>` ([formats.ts:621](../../personagen-svelte/src/lib/formats.ts#L621)) — must name the unit.
- `billedUnits`'s switch ([formats.ts:596](../../personagen-svelte/src/lib/formats.ts#L596)) — must decide the multiplier; `PlanInput` gains a `megapixels` field alongside `seconds` / `shots` / `items`.
- Nothing else: `billingFor` already resolves format → model → step → `per_call`.

Two pieces of good news from the sweep:

- **`parsePriceText` already parses "per megapixel"** ([model-registry.ts:801](../../personagen-svelte/src/lib/server/model-registry.ts#L801), basis `'per megapixel (1MP)'`) — discovered rows price correctly with no parser change.
- **The megapixel count is knowable at quote time.** The still's aspect is pinned by the format and `nano-banana-2/edit` defaults to `resolution: "1K"` (verified in its spec) — ~1.0 MP at 3:4. The quote must bill the **output** MP of the upscale (×4 at factor 2), not the input.

### 5.3 What breaks the generated-adapter mechanism

| Mechanism | What happens | Consequence |
|---|---|---|
| `adapterFromProbe` ([model-registry.ts:1019](../../personagen-svelte/src/lib/server/model-registry.ts#L1019)) | First line is `if (!probe.textParam) return null`. **Every** endpoint in §1–§3 except `clarity-upscaler` and `ideogram/upscale` has no `prompt` / `text` / `input` field. | No generated adapter, ever. |
| `probeModelSchema`'s `ok` | Requires `Boolean(textParam)`. | These rows probe as **not ok** → the models API sets `status: 'quarantined'` ([models/+server.ts:227](../../personagen-svelte/src/routes/api/models/+server.ts#L227)). |
| The Model Manager **swap** path ([models/+server.ts:288](../../personagen-svelte/src/routes/api/models/+server.ts#L288)) | Refuses with *"has no generated adapter — run Probe first"*. | **They can never be wired through the UI.** They must be hand-written `MODEL_CATALOG` entries with a hand-written call site — the same route every wired model already takes. This is a correct refusal, not a bug. |
| `CATEGORY_TO_KIND` ([model-registry.ts:771](../../personagen-svelte/src/lib/server/model-registry.ts#L771)) maps fal's `image-to-image` → `image_edit` | Every endpoint in this document is categorised `image-to-image`, so the fal sync is **already** discovering them as staged `image_edit` rows. | Cosmetic confusion only (they sit quarantined and unwirable). The new stages must **not** reuse `image_edit`, or a swap could drop a prompt-less upscaler into the composite slot. |
| Output shape | `ModelAdapter.output` admits only `'video.url' \| 'videos[].url'`; image shapes collapse to `null`. Meanwhile the endpoints split cleanly in two: **`{image:{url}}`** (seedvr, codeformer, esrgan, recraft ×2, bria, topaz, clarity, drct, retoucher) vs **`{images:[{url}]}`** (image-editing ×3, ideogram, crystal, phota, portrait-enhance). | `generate.ts` reads `data.images?.[0]?.url` at **eleven** sites and never reads the singular form. The chain needs a reader that handles both: `data.image?.url ?? data.images?.[0]?.url`. |
| Latent, pre-existing, worth one line | `VIDEO_SYNONYMS` contains `'video_url'` and `find()` checks presence, not requiredness. `fal-ai/nano-banana-2/edit` now declares an **optional** `video_url`, so probing our own default edit model yields `ok:false` and a null adapter. | Not caused by this work, but it means "the probe says no" is not evidence a model cannot run. |

### 5.4 File by file

| File | Change |
|---|---|
| [`src/lib/models.ts`](../../personagen-svelte/src/lib/models.ts) | Add `'image_upscale' \| 'image_face' \| 'image_detail'` to `ModelKind`; add `'per_megapixel'` to `Billing`; add the catalog rows (id, tier, `usd`, `billing`, `note`, `caveat`); add three `DEFAULT_MODEL` entries. `ModelOption` has no field for "consumes an image, returns one" — `sizeParam: 'none'` is the honest value. |
| [`src/lib/formats.ts`](../../personagen-svelte/src/lib/formats.ts) | Add the `StepKind`s; fill `STEP_LABEL` and `STEP_PURPOSE` (both `Record<StepKind,…>`, so the compiler enforces it); add the `UNIT_NOUN` entry; add the `billedUnits` case + `PlanInput.megapixels`; append the steps to the still-bearing formats (`photo`, `spokesperson`, `listicle`, `product-motion`, `vo-broll`, `auto`, `cinematic`, `reel-remake`, `motion-transfer`, `narrated-reel`). **Not** `text-card` / `motion-card` — there is no face and no photographic texture on a typeset card, and a realism LoRA over type corrupts it. |
| [`src/lib/pricing.ts`](../../personagen-svelte/src/lib/pricing.ts) | `PRICING_MATRIX` rows per wired stage; `OPERATION_LABELS.enhance`; a `GenerationProvenance.enhance` block recording **which stages ran, at what price, and the pre-enhancement original URL** — the teardown's A/B evidence and undo, and the same truth-contract discipline as the existing `v2v` block. |
| [`src/lib/server/content/generate.ts`](../../personagen-svelte/src/lib/server/content/generate.ts) | The chain runs where every still branch has converged — immediately after the final `else` of the still block (~L4523) and **before** the `// ── Video —` comment (~L4527). At that point `still` is one URL and both the talking-head and the i2v stages consume it, so enhancing there improves the video too. One `costEvents.push` per stage that ran; `try/catch` per stage returning the previous URL. Persist through the existing `persistBufferToStorage` path. |
| [`src/lib/server/settings.ts`](../../personagen-svelte/src/lib/server/settings.ts) + [`flags.ts`](../../personagen-svelte/src/lib/server/flags.ts) | `enhance_chain: 'off' \| 'upscale' \| 'face' \| 'full'`, default `'off'`, `coerce()` failing safe to `'off'` exactly like `video_ingest` / `persona_backbone`. Env override `UGC_ENHANCE_CHAIN`. No SQL. |
| [`src/routes/api/agent/[agentId]/generate-post/+server.ts`](../../personagen-svelte/src/routes/api/agent/%5BagentId%5D/generate-post/+server.ts) | Add the new steps to `planOptions` / `planFixed` (~L583–L620) and pass `megapixels` into `planPipeline` (~L670) so the composer quotes the chain before the user commits. |
| [`GenerationComposer.svelte`](../../personagen-svelte/src/lib/components/generation/GenerationComposer.svelte) | The **Standard / Realistic / Ultra** tier control the teardown's §6 asks for, mapping to `off / upscale+face / full`. A Craft-step control, not a new pane — `craftMatters()` already gates it. |
| [`src/lib/server/metering-audit.spec.ts`](../../personagen-svelte/src/lib/server/metering-audit.spec.ts) | Nothing, **if** the chain lives in `generate.ts` and pushes through `recordCostEvents`. If it moves to its own module it must carry a `METERED_MARKERS` call or the D11 invariant fails the build — which is the desired behaviour. |

---

## 6. The recommended chain

**Default (`enhance_chain = 'full'`, sold as "Ultra"):**

```
still  →  fal-ai/codeformer             (fidelity 0.5, upscale_factor 1, face_upscale true)
       →  fal-ai/image-editing/realism  (lora_scale 0.4, below the 0.6 default, seed pinned)
       →  fal-ai/seedvr/upscale/image   (upscale_factor 2, noise_scale 0.1)
       →  durable store                 (pre-enhancement original kept alongside)
```

**Why this order, against the teardown's:**

1. **Face first, at native resolution.** Codeformer is the only region-limited stage with a fidelity bound; running it first means it operates on the base model's own pixels rather than on another model's reinterpretation of them — and running it at `upscale_factor: 1` keeps the per-megapixel bill at ~$0.002 instead of ~$0.008.
2. **Detail second.** `image-editing/realism` is the whole-frame generative step and therefore the identity risk; it goes after the face is already correct and before the pixel count multiplies. It is per-call, so it is price-indifferent to position — but the 256×256 floor and the latency are not.
3. **Upscale last.** Non-generative super-resolution should be the final operation, because everything before it costs per megapixel and every model before it has a resolution bucket to fight. Last is both the cheapest ordering and the one where the final thing to touch the image cannot invent anything.

**Ship order (rollout, not runtime):** `upscale` → `upscale+face` → `full`, one flag value at a time, each gated by the blind benchmark the teardown's P0.2 demands. This preserves the assessment's instinct — ship the safe one first — while correcting its reason: upscale ships first because it is **nearly free and provably non-generative**, not because face restore is the risky one.

**Free tier:** `enhance_chain = 'off'` still gets the ffmpeg `lanczos + cas + grain` pass at $0 on hosts that declare the `ffmpeg` capability. It is a real improvement on the soft-render tell and it costs nothing, which makes it the correct floor rather than a null.

### Cost delta per image

Base still today: `nano-banana-2/edit` @ **$0.080** = **24 credits** at the shipped `credit_markup = 3` (`credits = ceil(usd × markup × 100)`, [money.ts:276](../../personagen-svelte/src/lib/money.ts#L276)). Assumed 1.0 MP in (nano-banana-2 `resolution` default `"1K"`, verified in spec), 4.0 MP out.

| Tier | Stages | Provider USD | Credits (×3, ceil) | Retail | Δ on the still | Added latency (measured) |
|---|---|---|---|---|---|---|
| Standard | ffmpeg only | **$0.0000** | 0 | $0.00 | — | ~0 s |
| **Realistic** | codeformer + seedvr | **$0.0061** | **2** | $0.02 | **+8 %** | ~17 s |
| **Ultra (full)** | codeformer + realism + seedvr | **$0.0461** | **14** | $0.14 | **+58 %** | ~25 s |
| Ultra, one-call variant | `topaz/upscale/image/precision` alone | $0.0800 | 24 | $0.24 | +100 % | not measured |

Working: codeformer $0.0021/MP × 1 MP = $0.0021; `image-editing/realism` $0.040 flat; seedvr $0.001/MP × 4 MP output = $0.0040. **The dominant cost is the single per-call stage, not the two per-megapixel ones** — which is the whole argument for shipping the cheap two first.

In the context of a whole post: a Spokesperson run today is ≈ $0.08 still + $0.03 TTS + $0.70 talking head + $0.002 director ≈ **$0.81**. The full chain adds **$0.046 — 5.7 %** of that. On an image-only Photo post it is 58 % of a much smaller number. **The chain is expensive relative to a still and cheap relative to a video**, which argues for pricing it as a visible tier rather than absorbing it — exactly as the teardown says.

### Value per dollar, and where the risk actually is

| Stage | Tell it attacks | Value per dollar | Risk | Evidence |
|---|---|---|---|---|
| **C — upscale** (seedvr) | Soft / low-detail render | **Highest.** $0.004 for 4× the pixels in 1.5 s | **Lowest.** Non-generative; measured aspect drift 1.3 %, from ×16 rounding | Measured live |
| **A — face** (codeformer) | Drifted / mushy face | High. $0.002, and `fidelity` bounds the damage | **Medium.** Region-limited, one tunable knob, no reference conditioning — it sharpens the face that is there; it cannot restore the face you pinned | Measured live |
| **B — skin** (realism) | **Plastic skin — the tell the teardown cares most about** | **Lowest.** $0.040 = 87 % of the chain's cost | **Highest.** Whole-frame diffusion at guidance 3.5 / 30 steps; the face is re-rendered as collateral | Measured live, aspect preserved |

**Testing the teardown's claim.** It says: *"Ship the upscale/detail pass first — it is the cheapest, the least likely to break identity, and it delivers the largest visible jump per dollar."*

- *Cheapest* — **confirmed**, by a wider margin than assumed ($0.004, not a fraction-of-a-cent guess).
- *Least likely to break identity* — **confirmed, conditionally.** True of seedvr / recraft-crisp / bria / drct. **False** of `clarity-upscaler` (`creativity: 0.35` by default), `recraft/upscale/creative`, and `flux-vision-upscaler`. The *category* is not safe; three specific endpoints are.
- *Largest visible jump per dollar* — **not supported.** Enlarging pixels cannot remove plastic skin, and plastic skin is the tell the document itself leads with. The largest visible jump on that tell belongs to stage B, which is also the dearest and the riskiest. Upscale-first remains right — on **risk and cost** grounds, not on visible-jump grounds. Do not expect the first flag value to close the gap; expect it to prove the rail.
- *"Face restore is the highest-value and highest-risk (a bad blend is worse than no pass)"* — **contradicted on the specs.** Codeformer is the *most bounded* model pass in the chain. The unbounded one is the skin pass.

---

## 7. Risks

| Risk | Severity | What the evidence says | Mitigation |
|---|---|---|---|
| **Identity drift from the skin pass** | **High** | `image-editing/realism` re-renders the entire frame at guidance 3.5 / 30 steps / `lora_scale` 0.6 | Ship it last; run at `lora_scale` 0.4; pin `seed`; the blind benchmark (P0.2) gates the flag value, not the code |
| **Aspect drift breaks the platform crop** | **Medium — measured** | `face-enhancement` turned 800×450 into 1392×752 (1.778 → 1.851). seedvr and realism preserved aspect to within ×16 rounding | Reject `face-enhancement` for the default chain; assert output aspect within 1 % of input or discard that stage's result |
| **Compute-second endpoints cannot be quoted** | **High if wired** | `esrgan`, `aura-sr`, `ccsr`, `retoucher` publish no per-unit rate | Do not wire any of them, however attractive `esrgan`'s `face:true` is |
| **A stage runs unmetered under `credits_mode=enforce`** | **High** | The standing trap; D11 catches it only when the call lives in an audited file | Keep the chain inside `generate.ts`'s `costEvents` / `recordCostEvents` path, or wrap it in `meteredCall` |
| **Storage and delivery cost** | **Medium, under-appreciated** | 4× the pixels is roughly 4× the bytes, on a storage host already measured at ~0.2–0.8 MB/s and not behind a CDN | Cap the upscale at 2×; encode JPEG/WebP, not PNG (`seedvr` defaults to `jpg`; `codeformer` returns PNG). The `optimizeForWeb` discipline at [video.ts:177](../../personagen-svelte/src/lib/server/video.ts#L177) needs a still-image sibling before this ships |
| **Latency** | Medium | Measured: seedvr 1.5 s, realism 7.6 s, recraft-crisp 9.9 s, face-enhancement 10.8 s, codeformer 15.9 s | The full chain adds ~25 s to a still. On an image-only post that roughly doubles perceived wait — which is also why the teardown's P0.4 ("Generated in 8s") and this work should not ship in the same week |
| **Silent quality regression on non-photographic stills** | Medium | A realism LoRA over a typeset card degrades the type | Exclude `text-card` / `motion-card` at the `FORMAT_CATALOG` level, not with a runtime `if` |
| **A quarantined discovered row gets swapped in** | Low | Blocked by the adapter gate — verified | Do not reuse `image_edit` for the new kinds |
| **The chain is sold as "identity restoration" it does not perform** | Medium | No verified endpoint conditions on the pinned reference (§2) | Name the tier for what it does — detail, sharpness, texture — never "keeps your persona consistent" |

---

## 8. Spend for this assessment

11 successful live calls against `fal.run` on 2026-09-09, ≈ **$0.175** total: `esrgan` ×1 (compute-second, ~$0.005), `codeformer` ×1 (~$0.004), `image-editing/realism` ×3 of which 2 billed ($0.08), `image-editing/face-enhancement` ×2 ($0.08), `recraft/upscale/crisp` ×1 ($0.004), `seedvr/upscale/image` ×1 (~$0.0015). One call returned HTTP 422 (`image_too_small`, input under 256×256) and is not billable. The balance was healthy throughout.

---

## Sources

All fetched 2026-09-09.

**Specs** — `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<id>`, the same URL [`probeModelSchema`](../../personagen-svelte/src/lib/server/model-registry.ts#L1063) uses:
[`fal-ai/seedvr/upscale/image`](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/seedvr/upscale/image) ·
[`fal-ai/codeformer`](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/codeformer) ·
[`fal-ai/image-editing/realism`](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/image-editing/realism) ·
[`fal-ai/image-editing/face-enhancement`](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/image-editing/face-enhancement) ·
[`fal-ai/image-editing/retouch`](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/image-editing/retouch) ·
[`fal-ai/retoucher`](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/retoucher) ·
[`fal-ai/esrgan`](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/esrgan) ·
[`fal-ai/clarity-upscaler`](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/clarity-upscaler) ·
[`fal-ai/aura-sr`](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/aura-sr) ·
[`fal-ai/recraft/upscale/crisp`](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/recraft/upscale/crisp) ·
[`fal-ai/recraft/upscale/creative`](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/recraft/upscale/creative) ·
[`bria/increase-resolution`](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=bria/increase-resolution) ·
[`topaz/upscale/image/precision`](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=topaz/upscale/image/precision) ·
[`clarityai/crystal-upscaler`](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=clarityai/crystal-upscaler) ·
[`fal-ai/ideogram/upscale`](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/ideogram/upscale) ·
[`fal-ai/drct-super-resolution`](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/drct-super-resolution) ·
[`fal-ai/phota/enhance`](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/phota/enhance) ·
[`fal-ai/image-apps-v2/portrait-enhance`](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/image-apps-v2/portrait-enhance) ·
[`fal-ai/nano-banana-2/edit`](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/nano-banana-2/edit) (baseline resolution default)

**Catalog & pricing** — `https://fal.ai/api/models?keywords=<kw>&page=<n>` (the endpoint [`syncFromFal`](../../personagen-svelte/src/lib/server/model-registry.ts#L846) already polls) for `upscale`, `face restoration`, `skin`, `retouch`, `codeformer`, `gfpgan`; rendered per-model pricing from each model's page under `https://fal.ai/models/<id>`.

**Companion documents** — [Fannabe teardown](fannabe-viability-assessment-2026-09-09.md) §2, §4, §6, §7 · [market-gap-assessment.md](market-gap-assessment.md) · [persona-model-v2-action-plan.md](persona-model-v2-action-plan.md)
