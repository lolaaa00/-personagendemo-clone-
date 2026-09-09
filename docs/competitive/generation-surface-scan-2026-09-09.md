# Generation Surface Scan — Types, Configuration, Variation, Quality

**Date:** 2026-09-09
**Question answered:** can we compete on *quality, configs, variations, and types of generations* — what are we missing?
**Scope:** a factual capability scan only. No roadmap, no priorities — another workstream owns that.
**Companion docs:** [fannabe-viability-assessment-2026-09-09.md](fannabe-viability-assessment-2026-09-09.md) · [market-gap-assessment.md](market-gap-assessment.md)

## 0. Method and evidence grading

Every claim below carries one of three marks. Nothing is asserted flat.

| Mark | Meaning |
|---|---|
| `[site]` | Stated on the vendor's own site, docs, or exposed API surface |
| `[3p]` | Reported by a third-party review or aggregator |
| `[inf]` | Inferred by this scan; not stated by anyone |
| `[ours]` | Verified in this repo at `feat/composer-upgrade-and-ui-defects` |

**Three structural caveats that shape everything below.**

1. **Almost nobody publishes an exhaustive option inventory.** Fannabe, Glambase, Botika and APOB gate the real configuration UI behind signup. "Not found" almost always means *not publicly disclosed*, not *absent*. Where a number exists it is usually because a reviewer counted it, or because the vendor shipped an API.
2. **Two vendors are outliers in disclosure and are therefore over-represented in the detail here:** **Creatify** (full public API enums) and **Higgsfield** (a live MCP tool surface whose model catalog was queried directly for this scan — the strongest evidence in the document, since it is the machine-readable parameter schema itself).
3. **Marketing counts contradict API counts.** Creatify's `/features` page says "29 languages"; its API enum lists **75**. Where they disagree, the machine-readable surface is treated as authoritative and the contradiction is flagged.

---

## 1. Types of generation

Distinct outputs a user can produce. ✅ ships · ⚠️ partial/gated · ❌ absent/undisclosed.

### 1.1 Primary cohort

| Output type | Fannabe | theinfluencer.ai | Higgsfield | APOB | Creatify | Argil | SynthLife | **PersonaGen** |
|---|---|---|---|---|---|---|---|---|
| Still photo (persona) | ✅ | ✅ | ✅ | ✅ | ⚠️ ad images | ✅ | ✅ | ✅ `photo` |
| **Carousel / multi-frame set** | ✅ 1-click, consistent outfit+bg | ❌ | ⚠️ via batch | ❌ | ❌ | ❌ | ❌ | ❌ |
| Image→video | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Text→video | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ❌ |
| Talking head / lip-sync | ✅ | ✅ | ✅ LipSync Studio, 8+ langs | ✅ ≤2–3 min | ✅ Aurora | ✅ ≤10–15 min | ✅ | ✅ spokesperson |
| **Multi-shot storyboard video** | ❌ | ✅ "up to six shots with real cuts" | ✅ `multi_shots` + `multi_shot_mode` | ⚠️ storyboard→video | ⚠️ template-driven | ✅ Story: ≤6 scenes / 15 s | ❌ | ✅ cinematic director |
| Motion transfer (ref clip → persona) | ✅ *paste an Instagram link* | ✅ 4–30 s upload | ✅ Genjutsu `motion_control` | ✅ | ❌ | ✅ Motion Control | ✅ | ✅ upload only |
| **Video→video re-skin / object replace** | ✅ Viral Reels Copy | ✅ reel recreation | ✅ Genjutsu `replace_object`; Kling Omni Edit; Seedance `video_edit` | ✅ ReVideo | ❌ | ❌ | ✅ Video Clone v2v | ✅ reel-remake |
| **Video extension / continuation** | ❌ | ❌ | ✅ Seedance `video_extension` fwd+back; FLUX 3 continuation | ✅ Extend Video | ❌ | ❌ | ❌ | ❌ |
| Character/face swap onto a photo | ✅ *onto an IG screenshot or selfie* | ❌ | ✅ Recast | ✅ | ❌ | ❌ | ✅ Reface | ❌ *(refused by policy)* |
| **Virtual try-on (garment)** | ❌ | ✅ top/bottom/one-piece | ✅ "UGC Virtual Try On" preset | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Product-in-hand / product interaction** | ❌ | ✅ hold-products | ✅ Brand Collabs; product_ids ≤4 | ✅ Product Video | ✅ Product-to-Video | ✅ *Product Interaction vs Presentation split* | ❌ | ⚠️ product-motion |
| **Image→prompt (decode)** | ✅ | ❌ | ⚠️ autoprompt on upscale | ❌ | ❌ | ✅ "copy the style of an image" | ❌ | ❌ |
| **Prompt enhancer** | ✅ | ❌ | ✅ | ✅ chat-to-generate | ✅ AI Scripts | ✅ | ❌ | ❌ |
| **Image editor (bg/composition/removal)** | ✅ | ✅ +undo/redo | ✅ inpaint, outpaint, bg-remove | ✅ | ⚠️ | ✅ magic editing | ✅ Magic Edit, in/outpaint | ⚠️ refine-post, no UI |
| **Upscale (image)** | ✅ | ✅ tool page | ✅ Topaz ×2 + Bytedance 2k/4k | ✅ via quality tier | ❌ | ❌ | ✅ 2K/4K | ❌ |
| **Upscale (video)** | ❌ | ❌ | ✅ Topaz 1080p/2160p; Bytedance ≤4k | ❌ | ❌ | ❌ | ❌ | ❌ *(`video.ts:123` "never upscale")* |
| **Skin / texture enhancement** | ✅ AI Skin Enhancer | ❌ | ⚠️ via Topaz face-enhance | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Face fix / identity restore** | ✅ "Fix Face" | ❌ | ✅ `face_enhancement` w/ 2 sliders | ✅ Advanced Face-Lock | ❌ | ❌ | ⚠️ reference lock | ❌ |
| Voice / TTS | ✅ | ✅ 40+ langs | ✅ create_voice, voice_change, dubbing | ✅ cloning | ✅ 140+ voices, cloning | ✅ full param set | ❌ | ✅ accent-matched |
| Music | ❌ | ⚠️ | ✅ TikTok trending-music tune | ❌ | ✅ 7,000+ tracks | ✅ | ❌ | ❌ |
| Captions / subtitles burn-in | ✅ | ✅ burned-in, exact spelling | ✅ 14 fonts, hex highlight, 3 positions | ✅ | ✅ 38 styles × 41 fonts | ✅ + export | ✅ | ✅ ffmpeg text card |
| **Long video → clips** | ❌ | ❌ | ✅ Personal Clipper: 1 YT URL → 1–20 clips | ❌ | ✅ AI Editing | ❌ | ❌ | ❌ |
| **Ad-format catalog / templates** | ✅ Easy Mode themes | ⚠️ | ✅ **986 Marketing Studio presets** | ✅ Complete Set | ✅ ~53 URL-to-video visual styles | ⚠️ 3 templates | ✅ Viral Templates | ⚠️ studio-templates |
| 3D / sprite / other | ❌ | ❌ | ✅ generate_3d, AutoSprite, 678-action rig library | ❌ | ❌ | ❌ | ⚠️ 3D-anime persona | ❌ |

### 1.2 Long tail — vendors with a distinct output shape

| Vendor | Distinct output types not covered above |
|---|---|
| **Arcads** | Talking-actor ad from a 1,000+ actor library; actor swap on a finished video; extend video; extract frame `[site][3p]` |
| **Captions / Mirage** | Prompt → *actor + background + voice + script in one shot*; **AI Twin from one selfie**; multi-shot with characters/styles/scenes held across transitions `[site][3p]` |
| **HeyGen** | Photo Avatar from **one** photo; custom video avatar from **~30 s** to camera; interactive video; SCORM/LMS export `[site]` |
| **Botika** | Flat-lay / packshot / mannequin → on-model garment photo; AI fashion video from one photo `[site]` |
| **Pippit (ByteDance)** | Link/file → video; talking photo; **apparel try-on**; batch product photos; studio backdrops with shadow/lighting; poster & banner with logo + CTA `[site]` |
| **Rasgo** | **Photo Dump** — a whole lifestyle series from a single input; Skin Fix; 8K upscale `[site]` |
| **Enhancor / PykASO / Imagera** | *Realism finishers as standalone products* — skin reconstruction + detail recovery + upscale in one pass `[site][3p]` |
| **Glambase** | Autonomous fan chat + PPV content sales; generation is a supporting surface `[3p]` |
| **createpersona.ai** | Auto-schedule and post to Instagram (TikTok/X "coming soon") `[site]` |

---

## 2. Configuration depth — the axis that matters most

### 2.1 Identity / trait configuration

| Vendor | Fields | Option counts | Unset state |
|---|---|---|---|
| **theinfluencer.ai** | 10 guided: gender, ethnicity, age, skin tone, eye colour, body, hair length, hair style, hair colour (+1) | gender 2 · ethnicity 7+ · age 7+ ranges · skin tone 3 · eye 6+ · body 5+ · hair length 3+ · hair style 3 · hair colour 8+ `[site]` | **"Best Fit"** on every row — zero required decisions `[site]` |
| **Fannabe** | ethnicity, age, face, eyes, hair colour, hair style, body, distinctive traits | **10 ethnicities · 6 age levels · 13 eye colours** `[site, own comparison article]`; body described as "detailed (natural/fake breast sizes, etc.)" `[site]`; traits: vitiligo, scars, burns, heterochromia, two-headed `[site]` | not disclosed |
| **Higgsfield** | ethnicity, age, eye colour, skin texture, Detail Tuning (scar, tear, posture) | **6 ethnicities · 3 age levels · 12 eye colours** `[3p — Fannabe's own comparison table, adversarial source, treat as soft]` | not disclosed |
| **APOB** | gender, age, nationality/ethnicity, eye colour, hairstyle, facial features, skin tone, height, weight | **no counts published**; ethnicity reported as 5 buckets `[3p]` | not disclosed |
| **SynthLife** | age, ethnicity, hair colour, eye colour → "Generate Face"; plus **Celebrity Face Mixing** | no counts `[site]` | n/a |
| **Glambase** | name → ethnicity → age → body type → skin colour → shape → look → hair colour → hair type → style → personality traits → bio | no counts `[3p]` | n/a |
| **Argil** | Appearance (age, gender, ethnicity) + Background (camera angle, time of day) + Assets (clothes, logos, products) — toggle groups | no counts; docs advise "10 to 30 lines of prompt" `[site]` | n/a |
| **PersonaGen** | `TraitPicker.svelte` exists but is wired **only into the persona edit page**; the rest is nine free-text fields | n/a | ❌ no Best-Fit equivalent surfaced `[ours]` |

> Fannabe's own head-to-head article is the only place in the market where trait option counts are published as a *competitive weapon*. That is a marketing move nobody else has made, and it is the reason those are the only hard numbers available.

### 2.2 Output format knobs

| Knob | Fannabe | theinfluencer | Higgsfield | APOB | Creatify | Argil | **PersonaGen** |
|---|---|---|---|---|---|---|---|
| **Aspect ratios (user-facing)** | ❌ undisclosed | **5** `[site]` | **7–15 per model**, e.g. `nano_banana_pro`: 1:1, 3:2, 2:3, 4:3, 3:4, 4:5, 5:4, 9:16, 16:9, 21:9; `ms_image`: 15 incl. 27:16, 16:27, 9:8, 8:9, 4:9, 9:4 `[site, MCP schema]` | **5**: 9:16, 3:4, 16:9, 4:3, 1:1 `[3p]` | **3**: 16x9, 1x1, 9x16 `[site]` | **2**: 9:16, 16:9 `[site]` | ⚠️ `sizeParam` plumbing exists in `models.ts`, **not user-facing** `[ours]` |
| **Resolution tier** | HD vs standard `[3p]` | ❌ | 1k / 1.5k / 2k / 4k on images; 360p→4k on video; Seedream "high" ≈6K `[site]` | 720P / FHD / Ultra / Ultra S / 4K `[site]` | ❌ | ❌ | ❌ |
| **Quality tier (priced)** | free vs premium `[3p]` | ❌ | `quality: low/medium/high/xhigh/max`; `mode: std/pro/4k`; `bitrate_mode: standard/high` `[site]` | 4 image tiers, 4 video tiers `[site][3p]` | Aurora 1 cr/s vs Aurora Fast 0.5 cr/s `[site]` | Classic vs Pro avatars/voices `[site]` | ❌ |
| **Video duration** | ❌ | 3–15 s, **tier-capped 5/10/15** `[site]` | 2–30 s depending on model; `wan3_0` accepts `-1` = model picks length `[site]` | 4 / 5 / 10 / 15 s `[site]` | 15 / 30 / 45 / 60 s `[site]` | per-scene 3–15 s, ≤6 scenes `[site]` | 5 s standard; per-second billing on v2v `[ours]` |
| **Model picker exposed to user** | LoRAs + motion control `[site]` | ❌ "frontier models" | ✅ ~35 image + ~35 video models with per-model schemas `[site]` | ✅ 7 video models named `[site]` | ✅ Kling v1.6 pro variants `[site]` | ✅ Playground: Seedance, Flux, Kling, Veo, Hailuo, Nano Banana `[site][3p]` | ✅ full catalog, priced in-UI `[ours]` 🏆 |
| **Negative prompt** | ❌ | ❌ | ❌ (not in schemas) | ✅ Expert mode `[site]` | ✅ ≤2,500 chars on Asset Generator `[site]` | ❌ | ❌ |
| **Prompt-adherence / CFG** | ❌ | ❌ | ✅ `cfg_scale` 0–1 `[site]` | ❌ | ✅ `cfg_scale` 0.0–1.0 in 0.1 steps `[site]` | ❌ | ❌ |
| **Prompt length cap** | ❌ | 3,500 chars `[site]` | ❌ | 20,000 chars chat / 1,024 build mode `[3p]` | 2,000 chars/segment `[site]` | 500 chars × 60 paragraphs `[site]` | n/a |
| **Reference/element slots** | ❌ | up to **2** props/outfits/backgrounds `[site]` | `ms_image` ≤14 media, ≤4 products; `soul_2` 1 ref `[site]` | **1 / 4 / 8 / 10 by quality tier** `[site][3p]` | ❌ | Story: **≤7 images**, or 1 video + 3 images `[site]` | multi-ref on nano-banana-2 `[ours]` |

### 2.3 Scene, camera, lighting and style presets

This is the single largest disclosed configuration gap.

| Vendor | Preset surface | Count |
|---|---|---|
| **Higgsfield — camera controls** | Named camera moves: General, Eyes In, Bullet Time, Aerial Pullback, Arc L/R, BTS, Buckle Up, Car Chasing, Car Grip, Crane Down/Up/Over-The-Head, Crash Zoom In/Out, Dolly In/Out/L/R, Dolly Zoom In/Out, Double Dolly, Dutch Angle, Eating Zoom, Fisheye, Flying Cam Transition, Focus Change, FPV Drone, Glam, Handheld, Head Tracking, Hero Cam, Hyperlapse, Incline, Jib Up/Down, Lazy Susan, Low Shutter, Mouth In, Object POV, Overhead, Pan L/R, Rapid Zoom In/Out, Road Rush, Robo Arm, Snorricam, Static, Super Dolly In/Out, Through Object In/Out, Tilt Up/Down, Timelapse Glam/Human/Landscape, Whip Pan, Wiggle, YoYo Zoom, 360 Orbit, 3D Rotation, Zoom In/Out `[site]` | **~56–70+** (site says "50+", 2026 reviews say "more than 70") |
| **Higgsfield — Marketing Studio v2** | Categories: `all, ugc, product-shot, motion, ads, posters, marketplace`. Types: `product_shots`, `product_shots_people`, `hypermotion`, `mixed_media`, `ugc`. Format slugs: `standalone`, `with-model`, `hypermotion`, `mixed-media`, `talking-head`. Sample names: Chilled Can, Ice Cube Hover, Golden Dew, Spa Morning, Poolside Float, Claymation Storm, 90s Bedroom CRT, Mystery Box, How-To `[site, MCP feed]` | **986 total** |
| **Higgsfield — image-to-video presets** | EARTH ZOOM, ORBIT 360, FLOAT SPIN, STICKER PEEL, SELFIE TWIN, CARDBOARD CUTOUT, ACTION FIGURE, CLAY FIGURINE, ICE STATUE, 2000'S PAPARAZZI, CANDID PAPARAZZI, RED CARPET, RACE TRACK, DRIFT RACING, FAN MEETING, ENDING FAIRY, NIGHT VISION, OFFICE CCTV, SUMMER HAZE, ZOMBIE DANCE, … `[site, MCP]` | **~64 named** |
| **Higgsfield — Soul styles** | Mystique city, Warm ambient, Editorial street style, Subtle flash, Old smartphone, Frutiger Aero, Swag era, Y2K outside, Nature light, Y2K Studio, Theatrical light, Siren `[site]` | **"20+ curated at launch"** |
| **Higgsfield — Shorts Studio** | Bold Urban, Green Contrast, Warm Glow, +35 others `[site]` | **40+** |
| **Higgsfield — Marketing hooks/settings** | `hook_id` = the *what* (attention mechanic, e.g. "Object flies into frame"); `setting_id` = the *where* (e.g. "Sunlit kitchen, morning light"). Independent axes, combinable `[site, MCP]` | count undisclosed |
| **Creatify — script styles** | BenefitsV2, BrandStoryV2, CallToActionV2, DiscoveryWriter, EmotionalWriter, GenzWriter, HowToV2, ProblemSolutionV2, StoryTimeWriter, ThreeReasonsWriter, TrendingTopicsV2 + ~29 hook variants (NegativeHook, SecretHook, WhatHappensHook, PriceDropRegretHook, …) `[site]` | **~50** |
| **Creatify — visual styles** | URL-to-video: ~53 templates. Avatar v2: 13 (FullAvatar, GreenScreenEffect, MagnifyingGlassCircle, TwitterFrame, Vlog, …) `[site]` | **53 + 13** |
| **Creatify — caption / typography** | 38 caption styles × 41 font families × 3 font styles; plus `font_size` (default 70), `offset`, `max_width`, `line_height`, `text_shadow`, `background_color`, `text_color`, `highlight_text_color` `[site]` | **38 / 41 / 3** |
| **Creatify — motion** | `background.effect`: imageSlideLeft, imageZoomIn, imageZoomOut, imageWobbling, imageThrob. `transition_in/out`: fade, leftSwipe, rightSwipe, topSwipe, bottomSwipe `[site]` | **5 / 5** |
| **Fannabe — Easy Mode** | Named scenes: Monaco, Flight Mode, Mirror Selfie, Photoshoot, Jungle Pool, Wine Tasting `[site]` | undisclosed |
| **theinfluencer.ai — scenes** | "cafés, gyms, mirrors, beaches, cars, offices and stadiums" `[site]` | undisclosed |
| **Arcads — settings** | home, office, car, kitchen, gym, street, outdoor `[3p]` | undisclosed |
| **PersonaGen** | `studio-templates.ts` realism registers (front-cam / mirror / propped selfie) — a *theory* of authenticity, not a named one-click scene grid `[ours]` | not surfaced as presets |

### 2.4 Genre / cinematic direction

| Knob | Where | Values |
|---|---|---|
| `genre` | Higgsfield `cinematic_studio_3_0`, `seedance_2_0` | auto, action, horror, comedy, noir, drama, epic `[site]` |
| `genre` | Higgsfield `cinematic_studio_video_v2` | auto, action, horror, comedy, western, suspense, intimate, spectacle `[site]` |
| `speedramp` | Higgsfield `cinematic_studio_video_v2` | auto, custom, linear, slowmo, speedup, impact `[site]` |
| `slow_motion` | Higgsfield `cinematic_studio_video` | bool `[site]` |
| `enable_thinking` | Higgsfield `wan3_0` | reason before generating `[site]` |
| Camera direction per scene | Argil Story | editable per scene `[site]` |
| Camera moves | APOB | dolly-in, pan, tilt, zoom, tracking, dynamic framing `[site]` |
| **PersonaGen** | ❌ no genre, no speed-ramp, no camera-move vocabulary exposed `[ours]` | |

### 2.5 Voice, language and performance

| Vendor | Languages | Voice params |
|---|---|---|
| **Argil** | ~30 via ElevenLabs `[site]` | **stability 50–80 (std) / 70–100 (Pro)**, **similarity 60–100 / 80–100**, speed (1.05–1.1 recommended), style; clone from **20 s–5 min**; ElevenLabs Pro clone needs **30 min**; *prompt-a-voice*; *voice-from-image*; voice-to-voice retarget `[site]` |
| **Creatify** | **75** (API enum; marketing says 29) `[site]` | 140+ voice characters, cloning, `voice.volume` default 0.8, `voice.model` v2/v3 `[site]` |
| **HeyGen** | **177+ languages and dialects** `[site]` | 300+ ready voices; clone from ~30 s `[site]` |
| **Captions** | **100+ languages**, 100+ caption styles `[site]` | Casting Voices, Finding Voices in-house models `[site]` |
| **theinfluencer.ai** | **40+** `[site]` | voice replacement w/ gender + accent on motion transfer `[site]` |
| **Higgsfield** | LipSync Studio "8+" `[site]`; dubbing tool separately | create_voice, voice_change, `sync_mode`: bounce/loop/cut_off/silence/remap `[site]` |
| **Pippit** | 869 voices / 28 languages `[3p]` — contested against "50+ voices, 20+ languages" `[3p]` | |
| **APOB** | 30+ content languages `[3p]` | cloning `[site]` |
| **PersonaGen** | ❌ single-language | 🏆 accent/nationality-matched, seeded voice identity `[ours]` |

### 2.6 Brand and product grounding as a *generation input*

| Vendor | Mechanism |
|---|---|
| **Higgsfield** | `brand_kit_id` — logo, images, colours, fonts, tone folded into the prompt; `product_ids` up to 4 with server-side IP check before queueing; preset + custom **avatar library** with gender metadata `[site, MCP]` |
| **Creatify** | **Brand Spaces** (≤5 on Pro); product URL ingest; **Performance Agent** reads live Meta/Google/TikTok/Applovin ad-account data back into creative choices `[site]` |
| **Flair.ai** | brand kit enforcing composition + colour consistency across flat-lays `[3p]` |
| **Argil** | Assets group: clothes, logos, products `[site]` |
| **PersonaGen** | 🏆 brand brief + scraped product catalogue + UGC guideline presets `[ours]` — still the deepest brand grounding found, but **no longer uncontested** |

---

## 3. Variation controls

| Control | Who has it | Specifics |
|---|---|---|
| **Batch N per prompt** | theinfluencer.ai **32** `[site]` · Higgsfield `ms_image` **batch_size 1–20** *plus* a separate `count` of parallel jobs `[site]` · MiniMax H3 / H3 Max **batch_size 1–4** `[site]` · ZenCreator **10** `[3p]` · APOB **2** at high quality `[3p]` · Imagera "10+ for A/B" `[3p]` | **PersonaGen: `num_images: 1` is hardcoded** at `generate.ts:494`, `:505`, `:547` `[ours]` |
| **Seed** | ZenCreator (save + reuse seed number) `[3p]` · SynthLife ("seed selection") `[site]` | **Nobody else exposes one.** Not Creatify, not Argil, not APOB, not Higgsfield's schemas, not us. Reroll is the category's only reproducibility primitive `[inf]` |
| **A/B variant matrix from one input** | Creatify **Batch Mode**: 10+ variants from one URL varying *avatar × script angle × hook style × aspect ratio* `[3p]` · Higgsfield "100 UGC and ad variants per product" `[site]` · Arcads 10+ ad variants/day `[3p]` | ❌ ours |
| **Preview → then pay to render** | **Creatify** — two-phase in the API itself (`/preview`, `/preview_list_async`, `/render`); aspect ratio switchable before a credit is spent `[site]` · **Higgsfield Supercomputer** — plan shown with credit cost per piece, user approves the spend, then it generates `[site]` | ⚠️ we price before running but have no free structural preview `[ours]` |
| **"Vary" / more-like-this** | Argil **Vary** button on avatar styles; **Use settings** recalls a past generation's prompt+settings; **Remix** reuses a Fiction video `[site]` · SynthLife "one-click variations" `[site]` | ❌ ours |
| **Reroll before commitment** | theinfluencer.ai unlimited free preview regeneration before lock `[site]` · Fannabe implied `[site]` | ❌ ours (landing page promises it) |
| **Multi-frame consistency (carousel)** | Fannabe — one click, outfit + background held across frames `[site]` · Rasgo **Photo Dump** `[site]` | ❌ ours |
| **Multi-shot with cuts** | theinfluencer.ai ≤6 shots `[site]` · Argil Story ≤6 scenes / 15 s, per-scene duration + camera + transitions editable `[site]` · Higgsfield `multi_shots` + `multi_shot_mode: auto\|custom` `[site]` · Captions cross-transition character/style/scene consistency `[3p]` | ✅ ours — cinematic director `[ours]` 🏆 |
| **Element shuffle** | Argil b-roll shuffle, **max 3 iterations** `[site]` | ❌ |
| **Concurrency** | APOB **6 tasks (Macro) / 18 (Mega)** `[3p]` · Imagera "concurrent processing slots" by tier `[3p]` | ⚠️ undisclosed ours |

---

## 4. Quality machinery

### 4.1 Post-generation passes

| Pass | Best-disclosed implementation |
|---|---|
| **Face restore / enhance** | **Higgsfield → Topaz**: `face_enhancement` bool + `face_enhancement_creativity` 0–1 + `face_enhancement_strength` 0–1 `[site, MCP schema]`. Fannabe "Fix Face" (named, unspecified) `[site]`. APOB "Advanced Face-Lock" (named, unspecified) `[site]` |
| **Skin / texture reconstruction** | **Rasgo Skin Fix** — Low / Medium / High intensity, restores "pores, micro-texture, natural imperfections" while preserving identity and composition `[site]`. **PykASO** — intensity sliders, demo shows Texture Recovery 82% / Artifact Cleanup 90% `[site]`. **Enhancor** — "Heavy Mode", granular texture sliders, skin editor adding pores/highlights/micro-textures `[3p]`. Fannabe AI Skin Enhancer `[site]` |
| **Upscale (image)** | **Higgsfield → Topaz** variants `Standard V2, Low Resolution V2, CGI, High Fidelity V2, Text Refine`, plus `sharpen` 0–1 and `denoise` 0–1; **Topaz generative** variants `Standard MAX, Redefine, Recovery, Recovery V2` with `creativity` 1–6, `texture` 1–5, `autoprompt` `[site, MCP]`. **Bytedance upscale** 2k/4k + `remove_bg` `[site]`. **Rasgo/Enhancor to 8K** `[site][3p]` |
| **Upscale (video)** | **Bytedance video upscale**: `fps` 24–60, `resolution` 1080p/2k/4k, `model_version` standard/pro, and a **content preset** — `common, aigc, short_series, ugc, old_film` `[site, MCP]`. Topaz video 1080p/2160p + frame interpolation `[site]` |
| **Deflicker** | Higgsfield `video_deflicker` `[site]` — nobody else has it |
| **Outpaint / reframe** | Higgsfield FLUX.2 Pro Outpaint: per-side pixel expansion −8192…+2048, negatives crop; an all-crop request is served locally **for free without the model** `[site]` |
| **Background removal** | Higgsfield image + video (`sam_3_video`, `apply_mask`, `frames_count`) `[site]`; ZenCreator, Arcads, Pippit `[site]` |
| **Human-in-the-loop retouch** | **Botika** — 2 retouch rounds + 2-day photo-fix (Pro), 3 rounds + 1-day (Advanced), custom briefs + white-glove QC (Enterprise) `[site]`. The only human QC layer found |
| **PersonaGen** | ❌ none of the above. Confirmed by search: no upscaler, no face restore, no skin pass anywhere in `src/`; the only `upscale` hits are prompt strings and `video.ts:123` "never upscale" `[ours]` |

### 4.2 Identity consistency mechanisms

| Vendor | Mechanism | Cost to the user |
|---|---|---|
| **Higgsfield** | **Soul ID** — trained embedding, **20–80 photos, ~3–5 min**; `soul_id` is then a first-class parameter on `soul_2` / `soul_cinematic`; `soul_cast` for cinematic identity `[site]` | upload 20+ photos |
| **APOB** | **Custom Portrait Model** — **10–20 photos, ~3–5 min**; slots by plan: Free 1 / Micro 2 / Macro 7 / Mega 18 `[3p]` | upload 10+ |
| **theinfluencer.ai** | **AI Clone** — **8–12 selfies, ~10 min**, locked to account `[site]` | upload 8+ |
| **Influencer Studio** | LoRA from **4–5 high-res photos** `[site]` | lowest disclosed bar |
| **Argil** | Avatar from **a single photo** (720p min, single face, mouth slightly open, not smiling); Avatar Styles = same face in arbitrary outfit/environment; async training with `avatar-training-success/failed` webhooks `[site]` | one photo |
| **HeyGen** | Photo Avatar from **one** photo; video avatar from **~30 s** of footage `[site]` | one photo |
| **Fannabe** | Explicitly markets **not training** — cross-engine consistency via reference conditioning + Fix Face, "model in under a minute" `[site]`. Simultaneously advertises **LoRAs** in its own comparison article `[site]` — internally inconsistent | none |
| **SynthLife / ZenCreator** | Reference lock + seed + face swap — no trained model `[site][inf]` | none |
| **Creatify** | Custom Avatar from user footage with **human review within ~24 h**; "Custom AI Model Fine-Tuning" is Enterprise-only `[site]` | footage + 24 h |
| **PersonaGen** | 5-stage reference kit + pinned character ref + multi-ref edit; **no trained model** `[ours]` | none |

> **The July doc's claim that "two of three competitors ship trained identity" understates it.** Five of the vendors scanned ship a trained/private model, and the disclosed entry bar has collapsed from 20 photos to **one photo** (Argil, HeyGen) or **4–5** (Influencer Studio). Cross-scan note: SynthLife and ZenCreator's *absence* of training is the minority position now, alongside Fannabe's — and Fannabe contradicts itself on it.

---

## 5. Table stakes — capabilities on two or more competitors

Ordered by how many independent vendors ship them. These are not novelties; a buyer comparing products will expect to find them.

| # | Capability | Confirmed on |
|---|---|---|
| 1 | **Talking head / lip-sync** | Fannabe, theinfluencer, Higgsfield, APOB, Creatify, Argil, SynthLife, Arcads, HeyGen, Captions, Pippit — *universal* |
| 2 | **A trained/private identity model with a published photo count and train time** | Higgsfield (20–80 / 3–5 min), APOB (10–20 / 3–5 min), theinfluencer (8–12 / 10 min), Argil (1 photo), HeyGen (1 photo / 30 s), Influencer Studio (4–5), Creatify (footage + 24 h) |
| 3 | **Image upscaling as a user-invokable step** | Fannabe, theinfluencer, Higgsfield, SynthLife, ZenCreator, Rasgo, Enhancor, Arcads, APOB |
| 4 | **A named, browsable preset/theme grid** | Higgsfield (986 + 64 + 40 + 20), Creatify (53 + 13), Fannabe (Easy Mode), SynthLife (Viral Templates), APOB (Complete Set), Arcads |
| 5 | **User-facing aspect-ratio choice** | theinfluencer (5), APOB (5), Creatify (3), Argil (2), Higgsfield (7–15), SynthLife (4), ZenCreator (3) |
| 6 | **A resolution or quality tier the user picks and pays differently for** | Higgsfield, APOB, Creatify (Aurora vs Aurora Fast), Botika (2K Pro / 4K Advanced), HeyGen (4K on Pro), Enhancor (4K gated) |
| 7 | **Batch generation with a published N** | theinfluencer (32), Higgsfield (20 + parallel jobs), ZenCreator (10), MiniMax-via-Higgsfield (4), APOB (2) |
| 8 | **Trend/reel recreation from an existing clip** | Fannabe, theinfluencer, SynthLife, Higgsfield (`ad_reference_id`), Creatify (Ad Clone), APOB |
| 9 | **Motion transfer from a reference video** | Fannabe, theinfluencer, Higgsfield (Genjutsu), APOB, Argil, SynthLife, ZenCreator |
| 10 | **Prompt enhancement / script generation** | Fannabe, Higgsfield, APOB, Creatify (~50 script styles), Argil |
| 11 | **Image editor with background/outfit/element edits** | Fannabe, theinfluencer (+undo/redo), Higgsfield, APOB, SynthLife, Argil, ZenCreator |
| 12 | **Virtual try-on / on-model garment** | theinfluencer, Higgsfield, Pippit, Botika, WearView, Uwear |
| 13 | **Product-in-hand / product insertion** | Higgsfield, Argil, Creatify, APOB, theinfluencer, Rasgo |
| 14 | **A "hold my hand" mode vs an expert mode** | Fannabe (Easy/Expert), APOB (Complete Set / Build Your Own / Expert), theinfluencer (Best Fit), Higgsfield (`image_auto`) |
| 15 | **Multi-shot output with real cuts** | theinfluencer (≤6), Argil (≤6), Higgsfield, Captions, PersonaGen |
| 16 | **Face-region enhancement or restoration** | Fannabe, Higgsfield (Topaz sliders), APOB (Face-Lock), Rasgo, PykASO, Enhancor |
| 17 | **Skin-texture / anti-plastic pass** | Fannabe, Rasgo, PykASO, Enhancor, Imagera, Influencer Studio — *and this is now a standalone product category* |
| 18 | **Caption/typography styling on burned-in text** | Creatify (38 × 41), Higgsfield (14 fonts, hex, 3 positions), Captions (100+ styles), Arcads, Pippit |
| 19 | **Stock avatar / pre-made persona library** | Arcads (1,000–1,500), Creatify (1,500+), HeyGen (1,100+), Pippit (80–600, contested), Higgsfield (preset avatars), Fannabe (prebuilt), theinfluencer (unlimited pre-made), Argil (100+) |
| 20 | **Preview or plan shown before credits are spent** | Creatify (API-level), Higgsfield Supercomputer (credit cost per piece, then approve), theinfluencer (free preview regen) |

---

## 6. Genuinely novel — found on exactly one vendor

Not table stakes. Listed because none of our existing docs mention any of them.

| Capability | Vendor | What it is |
|---|---|---|
| **Ad-reference decomposition** | Higgsfield | `ad_reference_id` — analyse an existing video and reproduce its *scenario*: scene composition, pacing, hook, narration. Explicitly mutually exclusive with `hook_id`/`setting_id`, i.e. two rival ways to specify structure `[site]` |
| **Hook × setting as orthogonal axes** | Higgsfield | `hook_id` = the attention mechanic; `setting_id` = the location/vibe. Combinable independently, supported on UGC / Tutorial / Unboxing / Product Review / Try-On presets `[site]` |
| **Agentic content-calendar planner with priced approval** | Higgsfield Supercomputer | Describe the week, formats and themes in one message; the agent plans the calendar, **shows credit cost per piece before generating**, executes on approval. CronJobs run recurring workflows (daily ad variations, weekly competitor scans); **up to 10 active scheduled tasks on Ultra**; 30+ connectors (Slack, Drive, Notion, Gmail, Figma) `[site][3p]` |
| **Virality Predictor** | Higgsfield | Scores a finished video for virality, engagement, attention, retention risk, hook strength `[site]` |
| **Breakout-reel intelligence** | theinfluencer.ai | "Analyze any Instagram account and get its breakout reels in seconds" — reels that beat their own creator's usual views by multiples, browsable by scene (cafés, gyms, mirrors, beaches, cars, offices, stadiums), 1-click recreation, ~2 min, ≤6 shots, caption burned in with exact spelling `[site]` |
| **Competitor ad tracker over 10M+ Meta ads → Ad Clone** | Creatify | Find a winning ad, clone its structure with your product `[site]` |
| **Performance Agent closed loop** | Creatify | Ingests live ad-account data from Meta, Google, TikTok, Applovin and feeds it back into creative decisions `[site]` |
| **IAB-compliant display banner generation** | Creatify | Spec-compliant banner sizes, not just social ratios `[site]` |
| **Product *interaction* vs *presentation* split** | Argil | Avatar physically holds and uses an uploaded product, as a distinct product from an avatar merely talking about it `[site]` |
| **Likeness royalty as a line item** | Argil | 20 credits/video paid to the owner of a stock avatar; waived if you trained your own `[site]` |
| **BYO vendor key zeroes the charge** | Argil | Linking your own ElevenLabs account sets the 20 cr/min voice charge to zero `[site]` |
| **Prompt-a-voice / voice-from-image** | Argil | Generate a voice from a text description, or from a face `[site]` |
| **Reference-slot count scales with quality tier** | APOB | 1 → 4 → 8 → 10 element slots as you climb Fast → Ultra 2K → Ultra 4K → Ultra S 4K `[3p]` |
| **Generate the last frame from the first frame** | APOB | Auto-derive an end keyframe, then interpolate — as a first-class toggle `[site]` |
| **Celebrity face mixing** | SynthLife | Blend celebrity faces into a non-existent face as a legitimate face-sourcing primitive `[site]` — note the obvious likeness-rights exposure |
| **Free local crop path** | Higgsfield | An outpaint request that is entirely crop is served locally, free, without invoking the model `[site]` |
| **Content-type-aware video upscaling** | Higgsfield | Upscaler preset tuned to source material: `common / aigc / short_series / ugc / old_film` `[site]` |
| **Human retouch rounds inside the SaaS** | Botika | 2–3 retouch rounds + 1–2 day photo-fix SLA + white-glove QC `[site]` |
| **"Photo Dump"** | Rasgo | A whole lifestyle series from a single input `[site]` |

---

## 7. Possibly stale in the existing assessments

Items in [fannabe-viability-assessment-2026-09-09.md](fannabe-viability-assessment-2026-09-09.md) and [market-gap-assessment.md](market-gap-assessment.md) that this scan puts in doubt. **None of these are re-measurements of our own product — only of theirs.**

| Existing claim | Evidence against | Confidence |
|---|---|---|
| **"Fannabe is not our competitor… different market"** and *"they market not training as the win"* | Fannabe's own comparison article lists **"Text-to-Video, Image-to-Video, Motion Control, and LoRAs all in one dashboard"** `[site]`. Either the no-training positioning or the LoRA claim is wrong. Also unrecorded: Fannabe's motion control is **"paste Instagram links"** `[site]` — URL ingest, which is precisely the guardrail line we drew | **High** — direct vendor contradiction |
| **"Higgsfield: platforms published to = 0"** (both docs) | Higgsfield's live tool surface exposes `tiktok_connect`, `tiktok_accounts`, `tiktok_prepare_publish`, `tiktok_publish`, `tiktok_publish_status`, plus `tiktok_music_trending` / `tiktok_music_tune` `[site, MCP]`. Their own blog says direct TikTok publishing is *not* offered `[site]` — the two contradict; at minimum publishing is no longer a clean zero | **High** on the contradiction, **Medium** on which is live |
| **"Higgsfield: scheduling ❌, autopilot ❌"** | **CronJobs** run recurring production workflows on Plus and above — "every morning, weekly, or once next Tuesday at 9am"; **up to 10 active scheduled tasks on Ultra**; use cases named as daily ad variations, weekly competitor scans, monthly content refreshes `[site][3p]` | **High** |
| **"Approval queue: uncontested 🏆"** | Higgsfield Supercomputer: *"Every plan… shows the credit cost upfront — before anything renders. You approve the spend, then it generates"* `[site]`. That is a priced approval gate. Ours is still broader (per-post brand approval, not per-render spend approval) but the row is no longer empty | **High** |
| **"Cost transparency & accounting: PersonaGen 9, everyone else ≤2"** | Higgsfield shows per-piece credit cost before generation `[site]`; **Creatify publishes a full per-endpoint credit table** in public docs (URL-to-Video 5 cr/30 s, Aurora 1 cr/s, Ad Clone 12 cr/5 s, …) `[site]`; **Argil publishes one too** (video 160 cr/min, voice 20 cr/min, b-roll 10–20 cr) `[site]`; **Arcads' per-model credit table** is reconstructible `[3p]`. We are still ahead on *retail-cent* honesty and a per-persona ledger, but "nobody publishes per-generation costs" is false | **High** |
| **"Trained identity: two of three competitors"** | Seven vendors in this scan ship it, and the entry bar has fallen to **one photo** (Argil, HeyGen) and **4–5 photos** (Influencer Studio) — not the 8–20 the July doc records | **High** |
| **"Higgsfield weakness: a generation studio with no distribution, marketed to a scattered creative audience"** | Marketing Studio v2 (**986 presets**), DTC Ads with brand kits and product IDs, Supercomputer agents with per-agent user counts (Product Photographer 5.2M, Cartoon Animator 3.4M), "100 UGC and ad variants per product" `[site]`. The commercial/DTC surface is now deliberate, not scattered | **High** |
| **"Motion transfer: theinfluencer 4–30 s"** and general reel-copy framing | Still true, but the shape has moved: theinfluencer now ships a **breakout-reel intelligence database** with per-account analysis and 1-click recreation `[site]`. The "trend *format* library, not asset replication" idea our Fannabe doc proposed as the safe alternative **already exists at a competitor** | **High** |
| **"createpersona: /pricing 404s"** | Pricing now renders at `/#pricing`: Starter $29/150 cr/3 influencers/1 GB · Pro $49/350/7/3 GB · Creator $79/700/unlimited/5 GB; clone now needs **3–10** reference photos `[site]` | **Medium** (page structure may still be flaky) |
| **Higgsfield pricing "Starter $15/200 · Plus $39/1,000 · Ultra $99/3,000"** | 2026 review reports **Starter $15/200 · Plus $34/1,000 · Ultra $84/3,000 · Business $49/seat**, credits still expiring at 90 days `[3p]` | **Medium** |
| **theinfluencer.ai treated purely as a UX/vocabulary benchmark** | It is now also a *trend-intelligence* benchmark (breakout-reel DB) and ships try-on + motion transfer + upscaler as separate tool pages. The "UX benchmark only" framing under-reads it | **Medium** |
| **Implicit assumption that trend-copy is legally exotic** | Six vendors ship reel/ad recreation; Creatify tracks 10M+ Meta ads to do it; Higgsfield does it via `ad_reference_id` on *user-supplied* references. It is a mainstream category feature, differentiated only by whether the source is scraped or uploaded | **High** |

### Not stale — confirmed still true

- **No competitor publishes 13-platform verified publishing.** Of everything scanned, only createpersona (Instagram), Pippit, and Higgsfield-via-TikTok touch publishing at all, and none confirm delivery.
- **No competitor has a brand brief + product-scrape grounding loop** at our depth. Higgsfield brand kits and Creatify Brand Spaces are the nearest, and both are asset containers rather than a written brief.
- **No competitor has a per-persona spend ledger.**
- **Nobody exposes a seed** except ZenCreator and SynthLife — reroll remains the category's only reproducibility primitive `[inf]`.
- **Nobody publishes an exhaustive trait-option inventory.** A product that publishes "18 scene presets, named" would be differentiated on the marketing surface alone.

---

## 8. Where PersonaGen sits, factually

Verified in-repo, not inferred.

| Axis | State | Evidence |
|---|---|---|
| **Types** | 13 catalog formats: `photo`, `text-card`, `motion-card`, `spokesperson`, `listicle`, `product-motion`, `vo-broll`, `reel-remake`, `narrated-reel`, `motion-transfer`, `cinematic`, `auto` (director), `campaign` (series) | `src/lib/formats.ts:168–338` |
| **Aspect ratio** | plumbing exists (`sizeParam: 'image_size' \| 'aspect_ratio' \| 'none'`), **not surfaced to the user** | `src/lib/models.ts:70,104–180` |
| **Batch** | `num_images: 1`, hardcoded on every image path | `src/lib/server/content/generate.ts:494,505,547` |
| **Seed** | not passed to any image model (the `persona-contract` RNG seeds *persona sampling*, not generation) | grep across `src/` |
| **Post-processing chain** | none — no upscaler, no face restore, no skin pass; the only `upscale` occurrences are prompt strings and `video.ts:123 // never upscale` | grep across `src/` |
| **Quality tier** | none exposed | — |
| **Model picker with per-call price** | ✅ full catalog, tiered, priced in-UI | `src/lib/models.ts`, `pricing.ts` |
| **Multi-shot** | ✅ director → storyboard → parallel stills → video | `generate.ts:1431` |

---

## Sources

**Fannabe** — [fannabe.com](https://www.fannabe.com/) · [Best AI Influencer Generators 2026](https://www.fannabe.com/articles/best-ai-influencer-generators) · [Higgsfield vs Fannabe](https://www.fannabe.com/articles/higgsfield-vs-fannabe) · [Clout AI review](https://www.tryclout.ai/blog/fannabe-ai-review) · [StartupHub review](https://www.startuphub.ai/ai-news/ai-tools/2026/fannabe-review-2026-is-it-worth-it-features-pricing-and-honest-verdict) · [Shyft](https://shyft.ai/tools/fannabe)

**theinfluencer.ai** — [theinfluencer.ai](https://www.theinfluencer.ai/)

**Higgsfield** — [ai-influencer](https://higgsfield.ai/ai-influencer) · [camera-controls](https://higgsfield.ai/camera-controls) · [soul-intro](https://higgsfield.ai/soul-intro) · [supercomputer-intro](https://higgsfield.ai/supercomputer-intro) · [TikTok pipeline guide](https://higgsfield.ai/blog/ai-tiktok-pipeline-2026) · [Soul ID explained](https://higgsfield.ai/blog/sould-id-best-character-consistency) · [creator-hub changelog](https://higgsfield.ai/creator-hub/changelog) · [fluxnote review](https://fluxnote.io/guides/higgsfield-ai-review) · *plus the live Higgsfield MCP model catalog (`models_explore`, `presets_show`, `marketing_studio_v2_presets`, `marketing_studio_v2_avatars`, `apps_search`), queried 2026-09-09 — the machine-readable parameter schemas quoted throughout §2 and §4*

**APOB** — [apob.ai](https://apob.ai/) · [AI Influencer Generator](https://apob.ai/ai-influencer-generator/) · [Image to Video](https://apob.ai/image-to-video-ai/) · [apobreview.com](https://apobreview.com/) · [pricing breakdown](https://apobreview.com/apob-ai-pricing/) · [AIGearBase](https://aigearbase.com/tool/apob-ai) · [make-influencer.ai](https://make-influencer.ai/tools/apob-ai)

**Creatify** — [creatify.ai](https://creatify.ai/) · [pricing](https://creatify.ai/pricing) · [docs index](https://docs.creatify.ai/llms.txt) · [billing / credit table](https://docs.creatify.ai/billing.md) · [AI Avatar v2 API](https://docs.creatify.ai/api-reference/lipsyncs_v2/post-apilipsyncs.md) · [URL-to-Video enums](https://docs.creatify.ai/api-reference/link_to_videos/post-apilink_to_videos.md) · [Aurora](https://docs.creatify.ai/api-documentation/aurora/aurora.md) · [Asset Generator](https://docs.creatify.ai/api-documentation/ai-generation/ai-generation.md)

**Argil** — [argil.ai](https://www.argil.ai/) · [playground](https://www.argil.ai/product/playground) · [docs index](https://docs.argil.ai/llms.txt) · [plans](https://docs.argil.ai/resources/subscription-and-plans.md) · [Story](https://docs.argil.ai/resources/story.md) · [Motion Control](https://docs.argil.ai/resources/motion-control.md) · [Product Interaction](https://docs.argil.ai/resources/product-interaction.md) · [Voices & Pro Voices](https://docs.argil.ai/resources/voices-and-provoices.md) · [B-rolls](https://docs.argil.ai/resources/brolls.md) · [The Rundown](https://www.therundown.ai/tools/argil)

**SynthLife** — [synthlife.co](https://synthlife.co/) · [ai-influencer](https://synthlife.co/ai-influencer) · [ai-character-generator](https://synthlife.co/ai-character-generator) · [Clout AI review](https://www.tryclout.ai/blog/synthlife-review)

**Glambase** — [glambase.app](https://glambase.app/) · [membership](https://glambase.app/membership) · [make-influencer.ai review](https://make-influencer.ai/tools/glambase)

**Arcads** — [arcads.ai](https://www.arcads.ai/) · [Wireflow pricing breakdown](https://www.wireflow.ai/blog/arcads-pricing) · [fluxnote review](https://fluxnote.io/guides/arcads-ai-review)

**ZenCreator** — [ai-influencer-generator](https://zencreator.pro/ai-influencer-generator) · [pricing](https://zencreator.pro/pricing)

**Captions / Mirage** — [captions.ai](https://www.captions.ai/) · [pricing](https://www.captions.ai/pricing) · [mirage.app](https://mirage.app/)

**HeyGen** — [avatars](https://www.heygen.com/avatars) · [pricing](https://www.heygen.com/pricing)

**Botika** — [products](https://botika.com/products) · [pricing](https://botika.com/pricing) · [WearView alternatives](https://www.wearview.co/alternatives/botika-alternatives)

**Pippit** — [pippit.ai](https://www.pippit.ai/) · [pricing](https://www.pippit.ai/pricing)

**createpersona.ai** — [createpersona.ai](https://createpersona.ai/)

**Realism finishers** — [Rasgo Skin Fix](https://www.rasgo.ai/fix-ai-skin) · [PykASO AI Skin Enhancer](https://www.pykasoai.com/ai-skin-enhancer) · [Enhancor](https://www.enhancor.ai/) · [Enhancor review](https://techpilot.ai/tools/enhancor-ai-fix-the-ai-plastic-skin/) · [Imagera](https://imagera.ai/blog/fix-ai-skin-plastic-look-2026) · [Influencer Studio](https://influencerstudio.com/features/ai-influencer-generator)

**Category surveys** — [reel.money — 12 best](https://reel.money/blog/12-best-ai-influencer-generators-in-2026-free-and-paid) · [WearView — best AI fashion model generators](https://www.wearview.co/blog/best-ai-fashion-model-generators)
