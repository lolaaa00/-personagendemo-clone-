# Our generation surface — what the product actually exposes (2026-09-09)

Read-only audit of `personagen-svelte` at `feat/composer-upgrade-and-ui-defects` (b6b4c27).
Evidence is code only. Comments and docs were not trusted; every "missing" claim carries the
search that found nothing. All paths are relative to `personagen-svelte/`.

**Headline numbers.** 13 catalog formats (10 offered on a default deployment), ~9 non-catalog
generation surfaces, 21 selectable models across 6 kinds, 22 voices, 5 card layouts, 41 Studio
templates. **Per-run knobs a user can set: 27.** Of those, **3 are dead or partly dead**. On the
persona side, **9 of 15 v1 profile keys reach the generator; the entire v2 persona contract
(~90 leaves, 305 tokens, 4 registries) reaches nothing.**

---

## 1. Types of generation

### 1a. `FORMAT_CATALOG` — the one axis a user picks

`src/lib/formats.ts:152-338`. 13 entries. Cost = provider USD from `planPipeline`
(`src/lib/formats.ts:648-683`) at catalog defaults; the customer is charged this × the credit
markup (`creditMarkup()`, default 3 — `src/lib/server/flags.ts:78`).

| id | kind | stages (`steps`) | needs | provider USD @ default | gating |
|---|---|---|---|---|---|
| `photo` | image | director, still | scene, framing, product, face | ~$0.082 (llm .002 + edit .08) | none |
| `text-card` | image | director, card | cardText, cardLayout, cardPalette | **$0.002** (card renders locally, $0) | none |
| `motion-card` | video | director, card, motion | + captions | **$0.002** (ffmpeg Ken Burns, $0) | `requires: ['ffmpeg']` `formats.ts:189` |
| `spokesperson` | video | director, still, tts, talkinghead | script, voice, scene, framing, face, product, captions | ~$0.812 | `needsFace` `formats.ts:200` |
| `listicle` | video | director, still, tts, talkinghead | + listItems | ~$0.812 + $0.03 × (beats−1) | `needsFace`, `requires: ['ffmpeg']` `formats.ts:224`; TTS billed `per_item` `:220` |
| `product-motion` | video | director, still, video | scene, product, face, captions | ~$0.502 | none |
| `vo-broll` | video | director, still, tts, video, mux | + script, voice | ~$0.532 | `requires: ['ffmpeg']` `formats.ts:247` |
| `reel-remake` | video | director, still, **v2v** | sourceVideo, face, captions | $0.082 + **$0.06/sec** | `needsFace`, `requires: ['videoIngest']` `formats.ts:262` |
| `narrated-reel` | video | director, still, v2v, tts, mux | + script, voice | $0.112 + $0.06/sec | `requires: ['videoIngest','ffmpeg']` `formats.ts:277` |
| `motion-transfer` | video | director, still, v2v | sourceVideo, scene, face, captions | $0.082 + $0.06/sec | `requires: ['videoIngest','ffmpeg']` `formats.ts:293` |
| `cinematic` | video | director, cine_stills, cine_video | scene, face, product, captions | ~$1.95 (stills billed `per_shot`, quoted at 4) | none |
| `auto` | video | director, still, tts, talkinghead | all of spokesperson | ~$0.812 | Director picks spokesperson-or-broll at run time (`generate.ts:3905`) |
| `campaign` | series | **none** (`steps: []`) | planner | $0 — hands off to CampaignPlanner | only offered when the caller passes `onOpenPlanner` (`GenerationComposer.svelte:212`) |

**Only 10 of 13 are reachable on a stock deployment.** `videoIngestEnabled()` defaults **false**
(`src/lib/server/flags.ts:189-193`, "Defaults OFF … a decision somebody has to take per
deployment"), so the three video-to-video formats are hidden by `buildableWith`
(`formats.ts:140-146`, client gate `GenerationComposer.svelte:186-193` — fails **closed**).

### 1b. Generation surfaces outside the catalog

| Surface | Route / entry | What it produces | Stages | Cost | Reachable from UI? |
|---|---|---|---|---|---|
| Avatar / hero portrait (from scratch) | `api/agent/[id]/generate-avatar` | 1 portrait, pinned as `ugc_character_ref` | 1 × `image_t2i` | $0.003–$0.08 | yes |
| Avatar from uploaded photo | same, multipart `reference`, 10 MB cap (`+server.ts:24`) | character sheet → hero shot | 2 × Nano Banana | ~$0.16 | yes |
| Avatar regenerate (edit) | same, `image_edit` | same person, fresh portrait (`generate.ts:2902-2914`) | 1 × edit | $0.02–$0.08 | yes |
| Reference kit stages 3–5 | `api/agent/[id]/generate-reference-kit` (`VALID_STAGES` `:20`) | side profiles, face close-up, feature grid | 1 Nano Banana each, **serial and gated** (`generate.ts:3482`, `:3490`) | $0.08 each | yes |
| Brand-brief store scrape | engine `action: 'scrape_store'` (`api/engine/+server.ts:1146`) | brand brief + products from a URL | Firecrawl + LLM | $0.0053/page + LLM | yes (`brand-brief/+page.svelte`) |
| Product scrape | `action: 'scrape_product'` (`:1743`) | one product record + photo | Firecrawl + LLM | same | yes |
| Brief field generate / extend / spin | `:2538`, `:1874`, `:2578` | one brief field of copy | LLM | ~$0.002 | yes |
| Full persona generation | `action: 'generate_full_persona'` (`:2257`) | persona + profile + portrait | LLM + image | ~$0.08 | yes (`generator/+page.svelte`) |
| Persona profile / identity kit / read-appearance-from-image | `:1932`, `:2092`, `:2471` | profile JSON, 13 platform bios, appearance fields | LLM (+ vision) | ~$0.002 each | yes (`personas/[id]/+page.svelte`) |
| Content Forge (blueprint) | `ContentForge.generate` → `action: 'generate'` (`:474`) | caption + product still only, **no video** (`:487-488`) | director + still | ~$0.082 | yes — calendar composer, "Forge with Competitor Blueprint" (`calendar/+page.svelte:152`, `:1296`) |
| Refine / re-roll a draft's media | `api/agent/[id]/refine-post` | full media re-generation from an edited scene | still → tts+talkinghead, or b-roll | full format price again | yes (`PostDrawer.svelte:252`) |
| Campaign planner | `CampaignPlanner.svelte` — **client-side only, no LLM plan call** | up to 60 queued drafts | N × `generate-post` | Σ `PIPELINE_USD` | yes (calendar) |
| Autopilot | `src/lib/server/autopilot.ts:420-436` | full UGC packs into empty slots; exactly 1 cinematic/day (`:286-291`) | full pipeline | full price | yes (scheduler + "Generate drafts now") |
| Studio templates | `src/lib/studio-templates.ts:130` — **41 templates** | pre-filled composer requests | whatever the pinned format is | 0 / .08 / .51 / .81 / 1.95 (`:1123-1129`) | yes (persona Studio tab) |
| Studio card sample | `api/studio/card-sample/[id]/[idx]` | real PNG tile preview, 10 text-card templates only (`:27-29`) | local ffmpeg | $0 | yes (tile art) |

**Studio template shape** (`studio-templates.ts`): 41 templates × 2 intents (brand 11 / channel 30)
× 4 surfaces (typographic 10, photo 11, motion 18, cinematic 2). A template is a *pre-filled
composer request* (`personas/[agentId]/+page.svelte:911-926`), not a script — its `topic`/`scene`
come back as editable fields.

**Unreachable server-side generation.** `src/lib/services/api.ts` exports eight ContentForge
methods with **zero callers**: `batchGenerate`, `autoSchedule`, `publishGenerated`,
`generateProfile`, `script`, `titles`, `thumbnailBrief`, `repurpose`.
`grep -rn "batchGenerate\|autoSchedule\|publishGenerated\|generateProfile\|\.script(\|\.titles(\|thumbnailBrief\|repurpose" src/ --include=*.svelte --include=*.ts | grep -v services/api.ts` →
**one hit, the server handler itself** (`api/engine/+server.ts:984`). The server implements
`batch_generate` up to `BATCH_MAX = 12` copies in one call (`api/engine/+server.ts:509-510`,
`src/lib/server/metering.ts:29`) — **the only true batch path in the product, and nothing in the
UI can call it.**

---

## 2. Configuration depth

### 2a. Per-run controls — the composer (27 knobs)

`src/lib/components/generation/GenerationComposer.svelte`. Body assembled at `:747-812`;
server read list at `api/agent/[agentId]/generate-post/+server.ts:137-392`.

| Knob | UI | Options | Sent as | Verdict |
|---|---|---|---|---|
| Format | kind chips → format chips (`:539-548`) | 13 (10 default-visible) | `media`/`format`/`still`/`refs` via `requestFor` `:766` | **read** — `+server.ts:146,257,303` |
| Persona switcher | select `:869` | all agents | re-resolves preview | **read** (route param) |
| Topic | free text + 24-item datalist from Studio topics (`:406-421`) | ∞ | `topic` `:767` | **read** `+server.ts:255` |
| Scene / visual brief | textarea, 1200 chars | ∞ | `scene` `:786` | **read** `+server.ts:261` → `generate.ts:3986` (outranks the Director verbatim) |
| Script / spoken line | textarea, 1200 chars | ∞ | `script` `:787` | **read** `+server.ts:320` |
| Voice | select `:1268`, sampled via `/api/voices` | **22** built-in (11F/11M), 5 accent tags (American 12, British 4, Indian 4, Australian 1, Swedish 1); extensible by `UGC_EXTRA_VOICES` (`voices.ts:150`) | `voice` `:788` | **read** `+server.ts:325`, `:483` |
| Framing | 3 chips `:1347-1387` | front / mirror / third | `framing` `:793`, only when touched | **partly read** — `front`→`SELFIE_LOOK`, `mirror`→`MIRROR_LOOK`, **`third` → empty string** (`generate.ts:988-991`). See §5. |
| Card text | textarea, 400 chars | ∞ | `card_text` `:789` | **read** `+server.ts:328` |
| Card layout | select `:1226` | auto + **5** (statement/quote/stack/list/split) | `card_layout` `:790` | **read** — whitelisted `+server.ts:331`, honored on both the local renderer (`generate.ts:4302`) and the model fallback (`withCardLayout` `:1037`) |
| Card palette | select `:1237` | auto + **ink/warm/cool/mono** | `card_palette` `:791` | **UI ONLY — DEAD.** `cardGroundOverride` accepts a **hex string only**; all four names fail `/^#?([0-9a-f]{3}\|[0-9a-f]{6})$/i` and return `null` (`generate.ts:1013-1017`). See §5. |
| Product (brand-kit) | select `:1393` | persona's brief products | `product_id` `:783` | **read** `+server.ts:253` |
| Product photo URL | text `:1422` | ∞ | `product_photo_url` `:784` | **read** `+server.ts:263` |
| Face override URL | text `:1450` | ∞ | `character_ref_url` `:785` | **read** `+server.ts:267` |
| Use my own still | text `:1628` | ∞ | `still_url` `:798` — zeroes the still stage (`:288`) | **read** `+server.ts:349` → `suppliedStillUrl` `generate.ts:1047` |
| Source clip | file upload → `/source-clip` probe `:596-635` | MP4/MOV/WebM, ≤100 MB, 1–30 s (`formats.ts:557-558`) | `source_video_url` + `source_seconds` `:801-802` | **read** `+server.ts:197-215`; measured duration is the per-second billing basis |
| Beat count (listicle) | 4 chips `:1290` | 3–6 (`MIN_ITEMS`/`MAX_ITEMS` `formats.ts:576-577`) | `list_count` `:806` | **read** `+server.ts:228` — multiplies TTS |
| Beat labels | up to 6 text rows `:1311` | ∞ | `list_items` `:807` | **read** `+server.ts:236` |
| Captions burn-in | checkbox `:1477` | on/off, **off by default** | `captions` `:771` | **read** `+server.ts:307` |
| AI-disclosure badge | checkbox `:1494` | on/off, off by default | `ai_badge` `:772` | **read** `+server.ts:308` |
| Quality tier | 4 segments `:1518` | budget / balanced / premium / **manual** | resolved into `picks` | **read** — `resolveStepModel` `formats.ts:601-639`; falls back to `via:'nearest'` and says so |
| Still model | per-stage select `:955` | 5 t2i or 3 edit | `still_model` `:794` | **read** `+server.ts:341`, `:575` |
| Video model | per-stage select | 5 i2v | `video_model` `:795` | **read** `+server.ts:271-279` |
| Talking-head model | per-stage select | 3 | `talking_head_model` `:796` | **read** `+server.ts:344`, `:619` |
| Director LLM | per-stage select | 3 | `llm_model` `:797` | **read** `+server.ts:346` |
| Provider routing | select `:1639` | auto / fal only / OpenRouter only | `provider` `:769` | **read** `+server.ts:258` |
| Platforms | chips, video-only platforms blocked pre-spend (`:344-348`) | connected accounts | `platforms` `:773` | **read** `+server.ts:137` |
| Schedule date + time | date/time inputs | — | `scheduled_date`/`_time` `:808-809` | **read** `+server.ts:391-392` |

**Not exposed at all:** aspect ratio, output resolution, clip duration, frame count, guidance
scale, steps, seed, negative prompt. Aspect is hard-coded `'9:16'` for every post still
(`generate.ts:1099`, `:1142`, `:1588`) and per-stage for the kit (`3:4`, `16:9`, `1:1` —
`generate.ts:3468-3496`). Duration is `env.UGC_VIDEO_DURATION || '5'` (`generate.ts:204`);
v2v resolution is a module constant `'580p'` with a comment saying it is deliberately not
env-overridable (`generate.ts:228`). Nine of the eleven knobs fal's wan-animate endpoint accepts
are deliberately left at schema defaults (`generate.ts:1471-1475`).

### 2b. Persona / identity configuration

**v1 flat profile — 15 keys** (`src/lib/persona-profile-store.ts:111-127`). This is the only
model generation sees: `readPersonaProfile()` runs `downgradeV2toV1()` on every blob before
generation (`persona-profile-store.ts:173-183`, `persona-contract/upgrade.ts:304-369`).

| Key | Control | Options | Verdict |
|---|---|---|---|
| `ageRanges` | age chips, `personas/[id]/+page.svelte:3777` | 6 buckets | **read** `generate.ts:881` |
| `ageMin`/`ageMax` | derived (`+page.svelte:2036`) | — | **read, fallback only** `generate.ts:883` |
| `gender` | select `:3801` | 2 + unset | **read** — priority-1 signal for voice + face `generate.ts:2761` |
| `archetype` | select `:3813` | **10** (`persona-profile.ts:11-22`) | **read** `generate.ts:872`, `:2885` |
| `contentFocus` | select `:3831` | **9** (`:24-34`) | **read** `generate.ts:876` |
| `contentAngle` | textarea `:3874` | free | **read** `generate.ts:877` |
| `targetAvatar` | text `:3848` | free | **read** `generate.ts:885`, `:2886` |
| `psychProfile` | textarea `:3860` | free | **read** `generate.ts:887` |
| `appearance` | `TraitPicker.svelte` `:3916` | **13 sub-fields** — see below | **read, portraits only** |
| `voiceProfile` `{gender,nationality,accent}` | **no UI** — LLM-written (`api/engine/+server.ts:2039`) | — | **STORED ONLY** |
| `bios` | Identity Kit textarea `:4318` | 13 platforms | **STORED ONLY** |
| `handleCandidates` | Identity Kit `:4262` | cap 16 | **STORED ONLY** |
| `confirmedHandles` | Identity Kit | — | **STORED ONLY** |
| `displayName` | Identity Kit `:4014` | free | **STORED ONLY** |

`grep -rn "\bvoiceProfile\b\|\bbios\b\|\bhandleCandidates\b\|\bconfirmedHandles\b" src/lib/server --include=*.ts | grep -v spec` → **no output.**

**`APPEARANCE_FIELDS` — 13 fields** (`persona-profile.ts:182-285`): 8 curated chip-pickers +
5 free-text under an "Advanced (5)" `<details>` (`TraitPicker.svelte:109-177`).
Option counts: ethnicity **12**, personaAge **7**, skinTone **8**, bodyType **8**, hairLength **7**,
hairstyle **10**, hairColor **8**, eyeColor **7** (= **67 curated choices**), plus free text for
wardrobe, outfitColors, headwear, distinctiveFeatures, styling. TraitPicker shows 3 options + a
"Best Fit" sentinel (stored as `''`, dropped at `persona-profile.ts:331`) + a `+N more` expander
(`TraitPicker.svelte:34`, `:141`).

> **All 13 appearance fields reach only the two portrait builders** — `buildHeroPortraitPrompt`
> (`generate.ts:2892`) and `buildPortraitEditPrompt` (`:2905`), via `appearanceToPromptClause`.
> They never enter a post's scene, script, motion or card prompt. Ethnicity is the one exception
> that is promoted to the portrait *subject* rather than a trailing clause (`generate.ts:2878-2884`,
> deliberate — `persona-profile.ts:364-366`).

**Agent-level config (`agent_configs`), read by generation:** `ugc_voice`, `ugc_format`
(auto/spokesperson/broll), `ugc_character_ref`, `ugc_reference_kit`, `brand_brief_id`
(`generate.ts:2184-2189`). Autopilot adds `autonomy_level`, `posts_per_day` (1–10),
`active_hours_start/end`, `timezone` (`autopilot.ts:106-133`, `:185-186`).

**Persona contract v2 — written, never read.** `src/lib/persona-contract/` holds a nested schema
of ~90 leaves, **49 token groups / 305 tokens** (`tokens.ts:327-377`), a 15-stage seeded sampler
(`sampler.ts:22-24`), and 4 registries carrying **360 first names, 180 surnames, 23 weighted trait
tables** (`registry/generic.ts`, `us.ts`, `uk.ts`, `au.ts`, `REGISTRY_VERSION = '1.0.0'`).
It is written on save (`buildStoredProfile`, `api/agents/+server.ts:56`,
`api/agents/config/+server.ts:143`) and thrown away on read.

```
$ grep -rn "lookToPromptClause\|lookPreservationClause" src --include=*.ts --include=*.svelte
src/lib/persona-contract/look-prompt.ts:129,167,209      ← definitions only
src/lib/persona-contract/look-prompt.spec.ts             ← its own spec

$ grep -rn "sampler\|samplePersonaSkeleton" src --include=*.ts | grep -v persona-contract/
(only changelog.ts and comments)

$ grep -rn "brief-constraints\|briefConstraints" src --include=*.ts --include=*.svelte | grep -v spec
(no output)

$ grep -rn "personaBackboneEmits\|personaBackbonePersists" src --include=*.ts | grep -v spec
src/lib/server/flags.ts:147,153                          ← definitions only
```

`personaBackbone()` defaults `'off'` (`flags.ts:137-139`), and the gate that would let backbone
facts into a prompt (`personaBackboneEmits`) **has no call site outside the admin settings
readout** (`api/admin/settings/+server.ts:73`). `brief-constraints.ts` (672 lines) has no importer
at all. So the v2 work is a complete parallel model with a switch that is off *and* not wired.

### 2c. Model choice

`src/lib/models.ts:97-397` — **21 models across 6 kinds**: `image_t2i` 5, `image_edit` 3,
`video_i2v` 5, `video_v2v` 2, `talking_head` 3, `llm` 3. Three tiers (`budget`/`balanced`/`premium`,
`models.ts:399`). Per-deployment the operator can override this catalog for 4 kinds via the Model
Manager registry (`REGISTRY_KINDS = ['image_t2i','image_edit','video_i2v','tts']`,
`model-registry.ts:44`); `talking_head` and `llm` are catalog-only and resolve statically
(`effectiveOptions` `:419-434`). A tier that cannot reach a stage reports `via: 'nearest'` rather
than pretending (`formats.ts:601-639`), and the composer states the reach numerically
(`GenerationComposer.svelte:1531`).

---

## 3. Variation controls

| Control | Present? | Evidence |
|---|---|---|
| Multiple images per run | **NO** | `num_images: 1` hard-coded at `generate.ts:494`, `:505`, `:547`. `numOutputs`/`num_outputs`/`n_images` → 0 hits |
| Batch generation (UI) | **NO** | `batch_generate` exists server-side up to 12 (`api/engine/+server.ts:509`, `metering.ts:29`) but `ContentForge.batchGenerate` has **zero callers** |
| Seed exposed to user | **NO** | `grep -rn "seed" src/lib/server/ src/routes/` returns only hash-based deterministic *picks* and DB seeding |
| Seed passed to any image/video model | **NO** | `generate.ts:1471-1475` explicitly declines to send `seed` to wan-animate; no other call site passes one. Media generation is irreproducible |
| Seeded determinism (personas) | **YES, but orphaned** | `persona-contract/rng.ts` — mulberry32 + `fork(label)` namespacing (`:43-51`), so a persona is a pure function of (seed, constraints, registry version). Feeds `sampler.ts`, which nothing calls |
| Deterministic non-media rotation | **YES** | hook framework rotation `generate.ts:724-733`; voice-by-seed `voices.ts:245-269`; card palette by `textHash` `card-renderer.ts:172` |
| Regenerate / re-roll | **YES, partial** | `refine-post` — full paid re-generation from an edited scene, not an improvement pass (`generate.ts:5177-5188`). Cinematic **refused** (`refine-post/+server.ts:76`). v2v formats collapse lossily to broll/spokesperson (`postDisplay.ts:84-110`) |
| A/B variants | **NO** | no `variant`/`variation` in any generation path |
| Automatic retry on media failure | **NO** | retries exist only for LLM text: hook score `generate.ts:1879`, grader rewrite `:3869`, cinematic shot count `:1937` |
| Reference-kit stage history | **YES** | `KIT_HISTORY_CAP = 24` per stage × 5 stages (`generate.ts:3083-3085`), CAS-guarded writes (`:3093-3157`), restore by `restore-kit-stage` |
| Avatar restore | **YES** | `listUserImages(svc, userId, 100)` — the 100 newest bucket images (`restore-avatar/+server.ts:54`) |
| Carousels / multi-image posts | **NO** | `carousel` → 6 hits, all advisory copy in `brand-brief/intel/+page.svelte:441,451`. `multi.?image` → 0. A post carries one `media_url` |
| Multi-shot | **YES, one format** | `cinematic` only — Director writes 1–5 shots, total ≤15 s (`generate.ts:1658-1675`, `:1758`). No shot-count control by design (`formats.ts:296-298`) |
| Campaign fan-out | **YES** | up to `MAX_POSTS = 60` (`CampaignPlanner.svelte:94`), 7/14/30-day horizon × 1–3/day × 4 weighted format classes. Anti-duplication is one appended sentence naming the slot index (`:262-266`); the Director is stateless |

---

## 4. Quality machinery — the blunt section

**There is no post-generation quality machinery of any kind.** Whatever the provider returns is
what ships, minus a lossy re-encode.

| Searched for | Result |
|---|---|
| `grep -ri "upscale\|upscaler\|super.?resolution\|esrgan\|realesrgan\|clarity" src/` | 5 hits — **none is code**. `generate.ts:3078` and `:3427` are the *words* "upscale to 4K" inside prompt strings sent to Nano Banana; `brief-constraints.ts:328` is a copy-lint word list; `changelog.ts:202` is a commit title; `video.ts:123` is `WEB_MAX_WIDTH = 720; // never upscale` — the opposite |
| `grep -ri "gfpgan\|codeformer\|face.?restor\|face.?fix\|face.?enhance" src/` | **0** |
| `grep -ri "detail.?enhance"` / `"denoise"` / `"sharpen"` | **0 / 0 / 0** |
| `grep -ri "inpaint"` / `"outpaint"` / `"remove.?background\|rembg"` / `"second.?pass"` / `"colou?r.?grade"` | **0 / 0 / 0 / 0 / 0** |
| `grep -ri "reframe"` | 6 hits, all comments and labels — no reframe code |

**What ffmpeg actually does** (`src/lib/server/video.ts`, soft dependency — every function returns
`null` without the binary, `:30-74`): (1) a **downscale-and-compress delivery pass**,
`scale=w=min(720,iw)` + `-crf 27 -preset veryfast` (`:135`, `:143-155`) — explicitly for file size
on an un-CDN'd host, and it can only *reduce* quality; (2) caption/badge burn-in (`:112`, `:424`);
(3) Ken Burns still→video for the motion card, which supersamples only so the zoom doesn't soften
(`:620-626`); (4) audio mux/concat (`:760-830`); (5) the $0 card raster
(`card-renderer.ts:442-500`).

**Negative prompts: one, on one path.** `negative_prompt: 'blur, distort, low quality, extra limbs,
missing product, wrong product'` — hard-coded, cinematic Kling only (`generate.ts:1727`). No other
model call passes one.

### What consistency machinery does exist — and it is real

The 5-stage reference kit is the strongest thing in the codebase. `resolveKitStagePlan`
(`generate.ts:3451-3497`) is the single source of truth:

| # | Stage | Refs passed | Aspect |
|---|---|---|---|
| 1 | `sheet` — 4-view turnaround + detail panels, ~330-word `CHARACTER_SHEET_PROMPT` (`:3078`) | uploaded photo or portrait | 16:9 |
| 2 | `full_body` | characterRef **+ sheet as a 2nd anchor** (`:3464-3468`) | 3:4 |
| 3 | `side_profiles` | full_body **+ sheet** (2 refs, `:3470-3478`) | 16:9 |
| 4 | `face_closeup` | side_profiles (1 ref, `:3480-3488`) | 1:1 |
| 5 | `feature_grid` | face_closeup **+ sheet** (2 refs, `:3490-3496`) | 1:1 |

Writes are CAS-guarded on a `rev` field (`generate.ts:3093-3157`) because four independent
read-modify-writes used to clobber each other's paid images. Prompts are gender-correct
(`genderWords` `:3419`). Stage 4 and 5 hard-error if the prior stage is missing (`:3482`, `:3490`).
The kit is consumed as `characterFrontal` + up to 3 `characterAngles` on the cinematic path
(`generate.ts:2047-2048`, `:1723`). `resolveFullBodyReference` (`:3577-3600`) **throws rather than
degrades** when v2v is handed a bust crop.

**The documented weak point.** `buildEditInput` at `generate.ts:503-509`:

```ts
if (model.multiRef) input.image_urls = imageUrls;
else input.image_url = imageUrls[0];
```

Everything past `imageUrls[0]` is silently dropped. For kit stages 3 and 5 that means the
character sheet — the anchor those prompts name out loud ("Upscale this **and the character
sheet**") — is discarded whenever the user picks FLUX Kontext or Qwen Image Edit
(`models.ts:168`, `:181`). The composer warns rather than degrading quietly
(`multiRefNeeded` `generate-reference-kit/+server.ts:137` → `GenerationComposer.svelte:256`),
which is honest, but the cheap edit models still ship with a known consistency loss.

### Anti-AI-tell scaffolding: thin on image, strong on text

**Image side — ~100 words across 5 fixed sites, none randomized.**

| Site | Text |
|---|---|
| `generate.ts:444-449` | `'UGC lifestyle photo, candid and authentic, shot on iPhone, natural lighting, real person not staged. '` (2 variants, ~17 words) |
| `generate.ts:1075` | `'Vertical 9:16 photorealistic UGC photo. Shoot quality: shot on iPhone 15 Pro with ProRAW, 24mm equivalent, natural light, real environment — NOT a studio ad or stock photo.'` |
| `generate.ts:1085` | `'Imperfection is quality: slight skin texture visible, natural shadows, lived-in authentic setting — not retouched or plastic-looking.'` |
| `generate.ts:2893`, `:2913` | `'…authentic iPhone selfie style… NOT a generic stock model.'` |
| `generate.ts:5175` | `'…Authentic, slightly imperfect, real — not a studio ad.'` |

Zero occurrences anywhere in `src/` of `blemish`, `asymmetr`, `pores`, `unretouched`, `airbrush`,
`chromatic aberration`, `harsh flash`, or film-grain-as-instruction. Every string is a module
constant; `Math.random` appears in no prompt path.

**The three realism registers** are genuinely good prose — `SELFIE_LOOK`, `MIRROR_LOOK`,
`PROPPED_LOOK` (`studio-templates.ts:111`, `:119`, `:127`), ~50 words each, spliced into 16 of the
41 templates. But the composer can pin only two of them (§5).

**Text side is an order of magnitude stronger.** `DIRECTOR_SYSTEM` (`generate.ts:2627-2675`,
~700 words) carries a **banned-words instant-fail list** (`:2636`: elevate, premium, transform,
game-changer, innovative, discover, unlock, revolutionize, seamless, leverage, curated, authentic,
amazing, incredible, journey, empower), a mandatory shot-type/lighting/DOF spec (`:2639-2648`), and
good/bad hook examples. Behind it sit two real gates: a hook-score retry at threshold 80
(`generate.ts:610`, `:1879`) and an **independent adversarial grader** — a separate LLM pass scoring
hook/authenticity/brandFit/cta with `overall = 0.5·hook + 0.2·authenticity + 0.2·brandFit + 0.1·cta`
(`:764-771`), a lenient env-tunable floor (`UGC_QUALITY_FLOOR`, default 5, `:758`), one
improvement-guided rewrite, and **abandonment of the slot before any media spend** if it still
fails (`:3863-3892`). Nothing equivalent exists for the image or the video.

---

## 5. Surprises

1. **The card Palette control is dead.** The composer offers `ink / warm / cool / mono`
   (`GenerationComposer.svelte:1237-1243`); `cardGroundOverride` accepts only a hex string and
   returns `null` for anything else (`generate.ts:1013-1017`). All four named palettes are silent
   no-ops. The route passes them through unvalidated (`+server.ts:335`) while the adjacent Layout
   field *is* whitelisted (`:331`) — so this is a validation gap, not a design choice.

2. **"Third person" framing sends nothing.** `framingClause` returns `''` for `third`
   (`generate.ts:988-991`). The comment argues this is deliberate ("the absence of a self-shot
   instruction") — but `PROPPED_LOOK`, a fully-written third register, exists at
   `studio-templates.ts:127` and the composer has no way to pin it.

3. **`ugc_video_quality` is a live DB column, read into the config object, and consumed by
   nothing.** Declared `'mvp' | 'premium'` (`generate.ts:2166`), read at `:2187`, migrated in
   `supabase/agent_configs_ugc_migration.sql`. `grep` for its consumption finds no branch, and no
   `.svelte` file writes it.

4. **The refine engine accepts 11 inputs; the refine route forwards 2.** `RefineInput` supports
   `cardText`, `cardLayout`, `cardPalette`, `framing`, `voiceOverride`, `talkingHeadModel`,
   `stillModel`, `stillUrlOverride` (`generate.ts:5140-5167`). The route reads only `post_id`,
   `scene`, `dialogue` (`refine-post/+server.ts:49-51`, forwarded at `:139`, `:196`) and the drawer
   sends only those (`PostDrawer.svelte:256-258`). Eight implemented, paid-for re-roll knobs are
   unreachable.

5. **The only real batch path cannot be clicked.** `batch_generate` (up to 12 copies, budget-gated
   up front) is fully implemented server-side and has zero UI callers, along with seven other
   ContentForge methods.

6. **The persona contract v2 is a finished parallel product with no wire.** ~90 schema leaves,
   305 tokens, a 15-stage seeded sampler, 360 curated names, 23 weighted trait tables, a look-prompt
   emitter, and a 672-line brief→constraints module — **none of it has a production caller**, and
   `downgradeV2toV1` deletes every v2-only leaf before generation reads the profile
   (`upgrade.ts:304-369`). `neverDiscusses`, a per-persona brand-safety denylist, is stored and
   never enforced anywhere.

7. **Appearance config only affects portraits.** All 67 curated appearance choices and 5 free-text
   fields reach `buildHeroPortraitPrompt`/`buildPortraitEditPrompt` and nothing else. Post images
   inherit identity from the reference *image*, not from the trait data — so editing hair colour
   changes the avatar and changes no post.

8. **The campaign planner has no server and no LLM.** `buildPlan()` is 40 lines of client-side
   arithmetic (`CampaignPlanner.svelte:182-221`) that fans out N independent, stateless
   `generate-post` calls. The only thing stopping 60 near-identical posts is one appended sentence
   naming the slot index (`:262-266`).

9. **Media generation is irreproducible by design.** No seed is passed to any image or video model
   anywhere; the codebase's only seeded RNG governs persona attributes and is orphaned. "Generate
   again" can never mean "the same thing, slightly different."

10. **Three defaults are inconsistent across write paths.** `posts_per_day` defaults 3 in
    `autopilot.ts:207` and on the persona page but **7** in `api/autopilot/+server.ts:72`;
    `active_hours_end` is 20 in autopilot and the API but **22** on the persona page
    (`personas/[agentId]/+page.server.ts:53`).

11. **`credits_mode` defaults `'off'`** (`flags.ts:33-35`) and `plans_enabled` defaults false
    (`:92`), so on a stock deployment every generation above is ungated by money.
