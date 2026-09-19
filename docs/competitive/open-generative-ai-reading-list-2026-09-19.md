# Open-Generative-AI — What Is Worth Reading for Our Composer, and Why

**Date:** 2026-09-19
**Subject:** `github.com/anil-matcha/open-generative-ai` (MIT) and its `packages/studio`, plus the three submodules (`Vibe-Workflow`, `Open-Poe-AI`, `Open-AI-Design-Agent`)
**Purpose:** a reading list, not an import list. Each entry names the file, what it measurably does, the idea in it, and the exact seam in our code the idea would land on. The verdict on the product and the company is in [muapi-white-label-viability-2026-09-19.md](muapi-white-label-viability-2026-09-19.md); this document assumes it.
**Method:** every file below was fetched from GitHub and read — the small ones whole, the 45–170 KB studio components by outline (state, handlers, comments) plus the specific functions named. Our side is file:line at `ux/portal-overhaul` on 2026-09-19.

---

## 0. The short version

Twenty-one things, ranked by what they would change for us. Six are worth doing soon, all small; the rest are ideas to keep or explicitly decline.

| # | Read this | The idea | Lands on | Priority |
|---|---|---|---|---|
| 1 | `generationLifecycle.js` — `appendGenerationRefundNotice` | Failure copy states the **charge outcome** ("Refunded 24 credits.") | `failure-text.ts`, composer error toast | **P1** — trivial, and it is our own never-bill-a-throw rule made visible |
| 2 | README "Multi-Image Input" + `ImageStudio` upload picker | Reference count and **order** are a per-model contract (`nano-banana-2-edit`: 14) | `refs: { character, product }` in `studio-templates.ts`, reference-kit stages fed to edit calls | **P1** — more kit stages into the edit model is an identity-consistency lever we are not pulling |
| 3 | `packages/studio/src/components/prompt/README.md` | A written **control contract** with pixel numbers, enforced by shared primitives | `docs/ux/system-audit.md`'s vocabulary drift; the portal overhaul in flight | **P1** — the missing artefact behind our "two toast systems, five status vocabularies" finding |
| 4 | `usePromptMenu.js` | One keyboard-complete menu hook: arrows, Home/End, Escape restores focus, roving focus to the checked item | The `a11y_*` share of our 167 svelte-check warnings; persona-page dropdowns | **P1** — one Svelte action closes a whole warning class |
| 5 | `imageInputContracts.js` | Required/optional inputs, labels, placeholders and the validation message derived from **one contract per (mode, model)** | `needs: [...]` in `formats.ts`; hand-rolled field checks in `GenerationComposer.svelte` | **P1** — we have the vocabulary and not the derivation |
| 6 | `groupedVideoRegistry.js` + `VideoStudio.getSelectionPlan` / `describeSelectionAdjustments` | Picking a variant shows **what else it changes** ("duration → 5s · resolution → 720p"), and impossible combinations are disabled *with a reason* | `tier` / `model` / `picks` state in the composer; the silent clamp at [generate.ts:1981](../../personagen-svelte/src/lib/server/content/generate.ts#L1981) | **P1** — a silent clamp is exactly what this UI makes visible |
| 7 | `imageSizing.js` | Resolve an aspect ratio to **legal** width/height for a model from its min/max/step, via gcd/lcm | `video.ts` aspect handling; the 4 % aspect-drift hazard in the realism-chain doc | P2 |
| 8 | `ModelParameterControls.jsx` | Schema-driven controls (enum → select, boolean → switch, number with min/max/step, arrays, nested objects), "advanced" keys hidden | Model Manager rows; the fal specs `adapterFromProbe` already fetches | P2 |
| 9 | `ImageStudio` `batchSize` + `Promise.all` | N variants of one composition, quote × N | `billedUnits` multiplier in `formats.ts`; the `/cards` batch that already does this for `$0` | P2 |
| 10 | README "Upload History & Picker" | Every reference ever used is one click away, with order badges | Nothing — we have no reference library beyond the persona kit and the brief's product photos | P2, **server-side and workspace-scoped**, never `localStorage` |
| 11 | `StandaloneShell.js` notifications | Generations in flight survive tab switches; per-tab counts; balance in the shell | `ui.svelte.ts` toasts, `ActivityIndicator.svelte`, post-observability | P2 |
| 12 | `AiInfluencerStudio` `handleShuffle` | "Surprise me" — randomise every look row | `TraitPicker.svelte` in the creation wizard | P2 — a one-button discovery aid; the rest of that studio is worse than ours (§2.5) |
| 13 | Design Agent: "lock a result, fork the plan, regenerate one stage" | Per-stage lock/regenerate in a multi-asset run | `CampaignPlanner.svelte`; `restore-kit-stage` already does this server-side for the kit | P2 |
| 14 | Vibe-Workflow / Workflow Studio | Saved, shareable, re-runnable **recipes** | `STUDIO_TEMPLATES` (fixed) → "My templates" saved from a run | P2 — recipes yes, node editor no (§2.7) |
| 15 | `MobileGenerationActions.jsx` | Copy image to clipboard as PNG (canvas re-encode, secure-context guard) | `PostCard` / `PostDrawer` actions, review queue | P3 |
| 16 | `CinemaStudio.buildNanoBananaPrompt` | Typed camera/lens/focal/aperture vocabulary → prompt fragments | Our realism registers and `framing: 'selfie'` — same mechanism, opposite register | P3 — mechanism only |
| 17 | `i18nUtils.js` | Per-component English bundle, deep-merged locale overrides, fallback on missing keys | Nothing yet | P3 — the right shape if we ever localise |
| 18 | Lip Sync Studio: pending jobs resume on reload | Resumable in-flight runs | Post-observability polling | note |
| 19 | Design Agent "text-rendering routing" | Route typographic prompts to text-capable models | `still: 'graphic'` + the `$0` card renderer | note — we already do the stronger thing (render, don't generate) |
| 20 | Open-Poe-AI agents | Agent = prompt + capability + profile + history | A persona is that plus a schedule and a ledger | note |
| 21 | Sandbox mode (muapi white-label) | A no-spend full flow | Already ranked in the muapi assessment | see there |

**Do not read for ideas:** the model catalogue files (`*Models.js`, `*Parameters.js` — muapi's catalogue shape, not a design), `muapi.js`, the Electron / `sd.cpp` / Wan2GP local-inference path, and anything under the "spicy" modes.

---

## 1. Composer input model

### 1.1 `imageInputContracts.js` — one contract per (mode, model)

**What it is** (4.4 KB, read whole). A frozen `BASE_CONTRACT` — `primaryImageRequired`, `primaryImageLabel`, `promptField`, `promptRequired`, `promptPlaceholder`, `auxiliaryImages` — patched per `"mode:model"` key: `i2i:ai-dress-change` adds a required `garment_image_url` labelled "Garment image"; `i2i:ai-product-shot` renames the prompt field to `scene_description` and requires it; `i2i:ai-object-eraser` requires a `mask_image_url`. Three functions consume the same contract: `getImageInputValidationError` (the user-facing message is *derived* — "Please upload a garment image."), `buildImageInputPayload` (only fields the contract names are sent), and `getAuxiliaryImageInputs` (a model's `swapField` is prepended as "Swap face image").

**The idea.** Required-ness, label, placeholder, validation message and payload are one object, so a new model is one entry and the UI cannot drift from what the pipeline sends.

**Where it lands.** We already have the vocabulary — `needs: ['sourceVideo', 'face', 'captions']` per format in [formats.ts](../../personagen-svelte/src/lib/formats.ts) (face ×10, captions ×10, product ×6, voice ×5, scene ×5, script ×5, sourceVideo ×3, cardText ×2 …) and `refs: { character, product }` on every studio template, documented as *"the composer must not show reference fields the run won't use."* What we do not have is the *derivation*: the composer's field checks, labels and placeholders are written by hand in [GenerationComposer.svelte](../../personagen-svelte/src/lib/components/generation/GenerationComposer.svelte) against `productPhotoUrl`, `characterRefUrl`, `stillUrl`, `sourceVideoUrl`, `script`, `listItems`. Turning `needs` into a contract that yields label + placeholder + validation + payload would remove a class of mismatch our own comment already warns about.

### 1.2 `imageSizing.js` — aspect ratios that the model can actually produce

**What it is** (3.7 KB, read whole). `getImageSizeCapability` classifies a model as `aspect_ratio` (an enum), `dimensions` (width/height each with `default/minValue/maxValue/step`), or `none`. `resolveImageDimensions` turns a ratio like `4:5` into concrete pixels that satisfy both steps — `scaleStep = lcm(widthStep/gcd(widthStep,w), heightStep/gcd(heightStep,h))`, clamped between the minimum and maximum legal scale, nearest to the model's default area. `getAspectRatioOptions` offers only ratios that resolve.

**The idea.** Never offer an aspect the model will round away. Compute the legal frame before the call, not discover the drift after.

**Where it lands.** The realism-chain feasibility measured `fal-ai/image-editing/face-enhancement` turning 800×450 into 1392×752 — a 4 % aspect drift on a 9:16 cover — and [video.ts](../../personagen-svelte/src/lib/server/video.ts) carries the comment that Move's output *"follows the REFERENCE aspect, not the source clip's."* Both are post-hoc corrections. A per-model size capability on the registry row, with this resolver, is the pre-hoc version. P2, because our formats pin aspect by platform and the drift cases are the enhancement stages, which are flagged and few.

### 1.3 `ModelParameterControls.jsx` — controls from the schema

**What it is** (9.2 KB, read whole). Given a model's input schema, renders the right control per field: `enum` → select with optional `optionLabels`/`emptyLabel`; `boolean` → `role="switch"`; `number|integer` → input with `min/max/step` and the schema's first example as placeholder; `array` → add/remove item list, with nested object items rendered recursively; `createEmptyValue` seeds defaults from the schema. `ADVANCED_KEYS = ["seed"]` are tucked away.

**The idea.** The composer does not know what a model's knobs are; it reads them.

**Where it lands.** Our Model Manager stores rows, modes, prices and probe results, and [`adapterFromProbe`](../../personagen-svelte/src/lib/server/model-registry.ts#L1019) already fetches each fal endpoint's OpenAPI. The input schemas are therefore *already on disk* for every wired model; nothing renders them. Today `nano-banana-2`'s `1K/2K/4K` resolution and Kling's duration are compiled-in constants. P2: surface a small allow-listed set of knobs (resolution, duration, quality) from the stored schema under an "advanced" disclosure, priced by `billedUnits`. Not P1 because every extra knob is an extra quote path to keep honest.

### 1.4 Grouped video families and the "selection plan"

**What it is.** `groupedVideoRegistry.js` (3.8 KB) registers every video model as a *variant* of a *family* with facets — `profile` (standard/pro), `speed`, `service` — and builds, per family × workflow, the set of facets that actually differ (`group.fields` only includes a facet if the family has more than one value for it). `resolveVariant` maps a facet change to a concrete model id, keeping the current one if it already satisfies the change. In `VideoStudio.jsx`, `getSelectionPlan` asks `planGroupedVideoSelection` what a proposed change implies; `describeSelectionAdjustments` renders the consequences — *"duration → 5s · resolution → 720p"* — onto the option itself; impossible options are `disabled` with `copy.incompatibleShort`; `applyControlsForModel` shows or hides the aspect/duration/resolution/quality controls per model.

**The idea.** A control never silently changes another control. Every option carries its side effects as text, and dead combinations are greyed with a reason rather than hidden or clamped later.

**Where it lands.** Our composer holds `tier`, `model`, `picks`, `framing`, `listCount`, `sourceSeconds` and computes `planTotalUsd(activePlan)` before spend — the *price* consequence is already surfaced. The *parameter* consequences are not: [generate.ts:1981](../../personagen-svelte/src/lib/server/content/generate.ts#L1981) *"defensively clamps LLM-produced shot durations to values Kling's API will"* accept — a silent clamp, downstream of the choice that caused it. `formats.ts`'s per-stage `tier?: QualityTier | 'manual'` "quality tier lock" is the same facet concept. P1 as a *presentation* change: when a tier or model pick changes a cap (seconds, shots, aspect), print it on the option the way the price is printed.

---

## 2. Prompt construction

### 2.5 `AiInfluencerStudio.jsx` — read it to confirm ours is better

**What it is** (46.8 KB, outlined; `buildPrompt` and `handleShuffle` read). Three tabs — Face, Body, Style — over **146 subcategories** (`character_type`, `gender`, `ethnicity_origin_base`, `eye_color`, `eyes_type`, `mouth`, `ears`, `horns`, `skin_conditions`, `face_skin_material`, `left_arm`, `right_arm`, `hair`, `accessories`, `rendering_style` …) with **127 `promptVal` fragments** ("elf with pointed ears", "reptilian creature", "mantis hybrid character", "two-headed"). `buildPrompt` concatenates every selected fragment after a fixed base: *"Ultra-realistic professional portrait photograph of an AI influencer character, 8k resolution, cinematic lighting, sharp detail"*. `handleShuffle` picks a random option in every subcategory. History is `localStorage`.

**Verdict.** Ours is better by design, and this file is the evidence:
- Their base prompt is the AI-glaze tell — *8k, cinematic lighting, sharp detail* is what our ProRAW anti-studio scaffolding and `framing: 'selfie'` registers exist to remove.
- Every row must have a value; there is no "leave it to the model". Our `TraitPicker` rows default to a real **Best Fit** chip, which is the honest option and the one the landing page sells.
- The taxonomy is a character generator (horns, hybrids, limb-by-limb), not a brand-safe persona surface.

**The one thing to take:** `handleShuffle`. A "surprise me" on the creation wizard that randomises within our eight curated rows — leaving Best Fit as a possible outcome — is a one-button discovery aid and costs nothing. P2.

### 2.6 `CinemaStudio.jsx` `buildNanoBananaPrompt` — mechanism, not vocabulary

**What it is** (read). Four typed dropdowns — `CAMERAS`, `LENSES`, `FOCAL_LENGTHS` (8–85 mm with a "human eye / portrait" perspective note), `APERTURES` (f/1.4 shallow, f/4, f/11 deep) — each mapping to a prompt fragment, joined after the base prompt with *"cinematic lighting, natural color science, high dynamic range, professional photography, ultra-detailed, 8K resolution."*

**Verdict.** Same mechanism we use for `framing`; opposite register. Theirs reads as an advert, which is what the Fannabe teardown says loses to a phone photo on a feed. If we ever want an "advanced look" for the deliberate set-piece templates (the third-person "photoshoot" looks `studio-templates.ts` reserves), a small typed vocabulary mapped to fragments is the right shape. P3.

### 2.7 Design Agent's plan → route → execute → assemble

**What it is** (README). *"Plan — break the brief into a deliverable list … Route — pick the right model per asset … Execute — generate in dependency order, threading the brand palette and reference images forward … Assemble."* And: *"You can interrupt at any step, swap a model, lock a result, fork the plan, or hand-edit any intermediate output and resume."*

**Where it lands.** This is our Director → grader → stages loop, and our `campaign` / `series` formats with `CampaignPlanner.svelte`. Server-side we already regenerate single stages (`restore-kit-stage`, `restore-avatar`). What we do not surface is *lock this result and regenerate only that* inside a multi-asset run. P2 — the routes exist; the affordance does not. Their "text-rendering routing" (typographic prompts go to text-capable models) is a weaker form of what we do — we render text with ffmpeg for `$0` and only fall back to a model.

---

## 3. Generation lifecycle and history

### 3.8 `generationLifecycle.js` — say what happened to the money

**What it is** (read whole). `pollForGenerationResult` retries on network error and 5xx, calls `onAuthRequired(status, detail)` on a 4xx mid-poll so the key modal can open, attaches `requestId` and the raw `generationResult` to every error, and times out with the request id in the message. `appendGenerationRefundNotice(message, error)` reads `error.generationResult.cost.refunded` / `amount_credits` and appends *"Refunded 24 credits."* to whatever the user sees.

**Where it lands.** Our rule is stronger — a provider call that threw is *never* billed, asserted by `money-claims.spec.ts` ("the ledger is flushed in a finally, so work already paid for is charged") — but our failure copy in [failure-text.ts](../../personagen-svelte/src/lib/server/failure-text.ts) does not say so. A user who sees "Generation failed" and a wallet they cannot reconcile assumes the worst. **P1:** every failure surface states the charge outcome from the ledger — *"Not charged."* or *"Charged for the still that completed: 32 cr."* — the same honesty we already spent a day putting into the quote.

### 3.9 Batch size

`ImageStudio.handleGenerate` runs `Promise.all(Array.from({ length: batchSize }) …)` and `addToHistory` keeps 50. We already have the machinery — `billedUnits` multiplies per-shot and per-second stages, and `/cards` batches up to 100 `$0` cards — but the photo composer produces one still per run. A `×N` on the confirm step, quoted as N × the still price, is P2.

### 3.10 Upload history and picker; multi-image input

README: every uploaded reference is kept (URL + thumbnail) in `localStorage`; the picker shows a grid; multi-image models expose checkboxes with **order numbers** ("images are sent to the model in the order you select them"), a count badge, batch upload, "Use Selected". The per-model cap table is explicit: `nano-banana-2-edit` 14, Kontext Dev 10, GPT-4o Edit 10, Flux 2 Pro Edit 8, Kontext Pro/Max 2, Qwen Edit 3.

**Where it lands — two separate things.**
- **Reference library (P2).** We have none: each run takes `characterRefUrl` / `productPhotoUrl` / `stillUrl` / `sourceVideoUrl`, the persona kit lives server-side, product photos come from the brief. A workspace-scoped "references used before" grid is a real convenience. It must be **server-side** — we are multi-tenant and `localStorage` is a per-browser fiction — which is also why we should not copy their implementation.
- **Ordered multi-reference with a model-declared cap (P1).** Our edit model is `nano-banana-2-edit`, which accepts up to 14 references. We send a character sheet and a product. The five-stage reference kit exists precisely to hold identity; feeding more of it, in a deliberate order, to the edit call is an identity-consistency lever we are not pulling — and the Fannabe scorecard has us at 6/10 on consistency. The cap belongs on the registry row, read from the probe schema (`images_list.maxItems`), never hardcoded.

### 3.11 Global generation notifications

`StandaloneShell.js`: `pushNotification` / `dismissNotification` persisted to storage, *"Global generation notifications remain mounted while users switch studios,"* per-tab `generationCounts`, balance fetched in the shell, drag-and-drop anywhere routes files to the active studio, deep-linked tab from the URL with `popstate` sync. Ours: per-post observability, `ActivityIndicator`, two toast systems (see `docs/ux/system-audit.md`). A single "in flight" tray across navigation — composer runs, autopilot, kit stages — is P2 and would also be the natural home for the charge-outcome line in 3.8.

---

## 4. UX system

### 4.12 `prompt/README.md` — the control contract

Read it whole; it is 3.6 KB and it is the most transferable file in the repository. *"Every model, aspect-ratio, duration, resolution, quality, preset, or similar control inside a floating prompt panel must: use `promptControlClassName()`; remain 38 px high; use a 12 px semibold label … Primary media attachments … must use `promptMediaButtonClassName()` … 40 px round … Every dropdown opened from a prompt control must use the shared popover primitives."* And the boundary: *"Keep API calls, validation, uploads, persistence, and generation handlers inside the owning Studio component. The shared prompt primitives own presentation and textarea resizing only."*

**Where it lands.** Our own audit found *"Status vocabulary drifts across 5 components … Two toast systems … the character image has 5 names in one viewport."* The fix we identified was one `STATUS_LABEL` map. This README is the general form: a short written contract with numbers, plus primitives that make the contract the path of least resistance. **P1 for the portal overhaul** — write ours before the next round of page work, not after.

### 4.13 `usePromptMenu.js` — one accessible menu

Read whole (2.9 KB). Trigger: ArrowDown/Home opens and focuses first, ArrowUp/End opens and focuses last. Menu: arrows cycle, Home/End jump, Escape closes *and restores focus to the trigger*, Tab closes without restoring; on open, focus lands on the `aria-checked` item. Items are `[role="menuitemradio"]:not(:disabled)`.

**Where it lands.** svelte-check on our committed tree reports 167 warnings; a visible share are `a11y_click_events_have_key_events`, `a11y_no_noninteractive_element_to_interactive_role` (`<img role="button">`) and `a11y_no_noninteractive_tabindex` in `personas/[agentId]/+page.svelte`. One Svelte action with exactly this contract, applied to every dropdown on that page, closes the class rather than the instances — and the per-rule ceiling gate is red today. **P1.**

### 4.14 `MobileGenerationActions.jsx`

Copy prompt; copy image as PNG through `ClipboardItem` with a canvas re-encode for non-PNG sources; a `window.isSecureContext` guard with a plain message. P3 — a nicety for the review queue.

### 4.15 `i18nUtils.js`

Per-component English bundle is the source of truth; `resolveCopy(en, override, locale)` deep-merges so a partial translation renders with English fallbacks instead of `undefined`. muapi ships 20 locales this way. We ship none and have no plan to; if that changes, this is the shape. P3.

---

## 5. Product-level ideas from the READMEs

### 5.14 Workflows — recipes yes, node editor no

Vibe-Workflow (MIT, 587 stars, Next + FastAPI, hardwired to `MU_API_KEY`) is a node-based pipeline editor with templates, "My Workflows", community sharing and *"every workflow is also callable via the Muapi API."* We chose a fixed, quoted, never-brick format catalogue on purpose; a visual graph editor is not our buyer's job and would break the quote-is-an-upper-bound invariant at every user-drawn edge. The transferable part is **saved recipes**: `STUDIO_TEMPLATES` is a curated shelf; "save this run as a template" (persona + format + picks + framing) is a small addition that gives an agency its own shelf. P2.

### 5.20 Agents

Open-Poe-AI: *"an agent here is a reusable, shareable unit that bundles a system prompt / persona, a target capability … its own profile page, slug, and conversation history."* A PersonaGen persona is that plus a brand, a schedule, a publishing history and a spend line. Nothing to take; useful as a sentence for positioning.

### 5.18 Resumable runs

Lip Sync Studio: *"pending jobs resume automatically on page reload."* Our detached routes (`generate-avatar`, the scheduler) already outlive the page; the composer's synchronous preview does not need it. Note only.

---

## 6. What we already do better, for the record

Read these to be sure we are not chasing them:

- **Quote before spend.** Their cost is a second API call (`/app/calculate_dynamic_cost`); nothing in the studio shows a price before "Generate". Ours is on every confirm step and asserted equal to the charge.
- **Best Fit.** Their persona rows force a value; ours default to "leave it to the model".
- **Realism register.** Their base prompts are "8k, cinematic"; ours are a phone in a hand, on purpose, with a measured post-processing stage behind it.
- **Text.** They route text prompts to text-capable *models*; we typeset for `$0` and only fall back to a model.
- **Tenancy.** Everything of theirs persists in `localStorage`; everything of ours persists per workspace with roles.

---

## 7. Sequencing

If one afternoon: **3.8** (charge outcome in failure copy) and **4.13** (the menu action) — both close things we already measured as open. If one week: add **3.10-b** (ordered multi-reference from the registry cap), **4.12** (write the control contract before the next portal round), **1.1** (derive validation from `needs`), and **1.4** (print parameter consequences on options the way price is printed). Everything else waits for a reason.

---

## Sources

- `packages/studio/src/imageInputContracts.js`, `imageSizing.js`, `groupedVideoRegistry.js`, `groupedVideoParameters.js`, `groupedVideoModels.js`, `i18nUtils.js`, `index.js`; `components/ModelParameterControls.jsx`, `VideoModelControls.jsx`, `MobileGenerationActions.jsx`, `prompt/PromptComposer.jsx`, `prompt/usePromptMenu.js`, `prompt/README.md`, `utils/generationLifecycle.js`; outlines and named functions of `ImageStudio.jsx`, `VideoStudio.jsx`, `AiInfluencerStudio.jsx`, `MarketingStudio.jsx`, `CinemaStudio.jsx`, `LipSyncStudio.jsx`, `WorkflowStudio.jsx`, `AgentStudio.jsx`; `components/StandaloneShell.js`; `project_knowledge.md`; README sections "Features", "Image Studio", "Video Studio", "Lip Sync Studio", "Workflow Studio", "Cinema Studio Controls", "Upload History & Picker" — all fetched from `github.com/anil-matcha/open-generative-ai` on 2026-09-19
- `SamurAIGPT/Vibe-Workflow`, `Anil-matcha/Open-Poe-AI`, `Anil-matcha/Open-AI-Design-Agent` READMEs and repo metadata
- PersonaGen: `formats.ts`, `studio-templates.ts`, `components/generation/GenerationComposer.svelte`, `components/generation/types.ts`, `components/persona/TraitPicker.svelte`, `server/content/generate.ts`, `server/video.ts`, `server/model-registry.ts`, `server/failure-text.ts`, `docs/ux/system-audit.md`
