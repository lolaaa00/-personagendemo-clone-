# PersonaGen — Competitive Teardown, Terminology & UX Standards Audit, Gap Analysis, Viability Assessment

**Date:** 2026-07-25
**Subjects analysed:**
- `theinfluencer.ai` — **the category benchmark** (UX, terminology, workflow)
- `higgsfield.ai/ai-influencer` — the craft leader (Soul ID, motion)
- `createpersona.ai` — the packaging play (thin product, good funnel)

**Purpose:** establish the industry-standard vocabulary and interface pattern for this exact niche, measure PersonaGen against it, and define the highest-viable product and landing page.

---

## 0. Executive verdict

Four things are now clear.

1. **`theinfluencer.ai` is the standard.** Their trait picker, their vocabulary, their three-step build loop, and their time-estimates-per-step are what a buyer in this niche now expects. Everything we present should be measured against them, not against the weaker two.
2. **We are ahead of all three on everything that happens *after* the image exists** — brand grounding, 13-platform publishing, verified delivery, autonomy, approval, cost accounting. None of them can run an account.
3. **We are behind all three on everything that happens *before* the image exists** — trait selection UX, preview-and-lock loop, trained identity, pre-made personas, try-on, motion transfer, languages.
4. **Our vocabulary is wrong.** We say *agent*, *soul*, *market*, *heartbeat*, *overseer*, *reference kit*, *UGC pack*. The industry says *persona*, *traits*, *locked identity*, *private model*, *batch*, *try-on*, *motion transfer*. This is not cosmetic — a buyer landing on our product will not recognise it as belonging to this category.

**The single highest-leverage correction:** adopt the industry's *front end* (vocabulary + trait wizard + preview/lock loop) while keeping our *back end* (the operations layer nobody else has). That combination is the highest viable product available in this market.

---

## 1. Teardown A — theinfluencer.ai ★ the benchmark

**Company:** Thunderbus Pte. Ltd. **Proof:** 10,000+ creators · 1,600+ AI influencers built · 65,000+ assets generated · 190+ countries. Featured in Unite.AI, Futurepedia, There's An AI For That, Product Hunt.

### 1.1 Positioning

> **H1:** "Create your own AI influencer."
> **Sub:** "Pick traits or upload your selfies — our AI influencer generator builds a photorealistic persona that stays consistent across every photo, video, and reel."
> **CTA:** Create AI Influencer · *Free to start · Build your first influencer in minutes*

Note the structure: **verb + noun in five words**, then a subhead that names *both input paths* and the *one promise that matters* (consistency). No adjectives. This is the copy pattern to follow.

### 1.2 The trait wizard — the interface we must match

The screenshot you provided is the most important artifact in this document. Deconstructed:

**Layout:** two panes. Left = `● PICK THE TRAITS · STEP 1 OF 2`. Right = `● PREVIEW · STEP 2 OF 2`. Both step headers visible simultaneously — the user sees the whole journey at once, which is why it feels short.

**Each trait row:**
```
LABEL (small caps, letterspaced, muted)   [Selected] [Option] [Option] [ +N more ]
```
- Selected chip: solid 2px dark border, bold label, white fill
- Unselected chips: 1px light border, regular weight
- Overflow chip: **dashed** border, `+5 more` — signals "more exists" without a dropdown
- Rows separated by hairline dividers; label column fixed-width so all chip rows left-align

**The ten guided fields:** Gender · Ethnicity · Age · Skin tone · Eye colour · Body · Hair length · Hair style · Hair colour *(+1)*

**The critical idea we are missing entirely — "Best Fit":**
> "Ten guided fields. Set the ones that matter, leave the rest on **Best Fit**. No prompt writing required."

Every field has a valid unset state that the model resolves intelligently. **Zero required decisions to reach a preview.** This is why their build takes ~30 seconds.

**The preview pane:** a real render with a badge reading `● SIRA · GENERATED IN 8S`, and beneath it a soft bar: *"Don't love the look? Regenerate the preview."* Under the traits: *"Regenerate the preview as many times as you want, then lock in the look you love."*

**Free regeneration before commitment is the entire trust mechanic of this category.** You do not spend, choose, or commit until you have seen the face and approved it.

### 1.3 The stated workflow — with times

| # | Step | Time shown | Copy |
|---|---|---|---|
| 01 | **Pick the traits** | `~30 SEC` | "Ten guided fields. Set the ones that matter, leave the rest on Best Fit. No prompt writing required." |
| 02 | **See the preview** | `8–30 SEC` | "A frontier-model render of your persona — on-brief, neutral, lit cleanly. Regenerate the preview as many times as you want until you love the look." |
| 03 | **Lock them in** | `YOURS FOREVER` | "Confirm and your persona becomes a **private model**. Same face on every photo, video, try-on, and motion clip you ship." |

**Publishing a time estimate on every step is a confidence signal.** It says *we know exactly how long our own pipeline takes*. We have that data (fal queue timings) and show none of it.

### 1.4 Second creation path — AI Clone

| # | Step | Time | Detail |
|---|---|---|---|
| 01 | Upload 8–12 photos | ~2 min | Different days, lighting, outfits; face clearly visible |
| 02 | We train your model | ~10 min | Personal model fine-tuned on your likeness, **locked to your account, never reused** |
| 03 | Generate as you | Yours forever | Reels, ads, product shots, voiceovers, lip-sync |

Plus **unlimited pre-made influencers** on every tier — instant activation with zero build.

### 1.5 Full capability set

| Surface | Specifics |
|---|---|
| **Photos** | Text prompt or reference image · 5 aspect ratios · **batch up to 32 per prompt** · up to 2 props/outfits/backgrounds |
| **Videos** | Prompt up to 3,500 chars · **native audio** · 3–15s clips · custom element image |
| **Edits** | Any edit as a prompt · **undo/redo per edit** · originals preserved · edits saved as new photos |
| **Try-On** | Upload garment → select top/bottom/one-piece → saved as new photo |
| **Motion Transfer** | Upload 4–30s reference video → motion applied to persona → **voice replacement with lip-sync** |
| **Languages** | **40+** — English, Spanish, German, French, Hindi, Arabic, Portuguese, Italian, Dutch, Polish, Turkish, Swedish… |
| Tools | AI Photo Editor · Image Upscaler · Virtual Try-On · Motion Transfer (each an SEO landing page) |

### 1.6 Pricing

| Tier | $/mo | Credits | Yield | Custom personas | Video len | Clone |
|---|---|---|---|---|---|---|
| Starter | **$19** | 100 | ~100 photos or 10–20 × 5s videos | 1/mo | 5s | ✗ |
| Creator ★ | **$39** | 250 | ~250 photos or 12–25 × 10s videos | 3/mo | 10s | ✓ |
| Professional | **$99** | 700 | ~700 photos or 23–46 × 15s videos | 8/mo | 15s | ✓ |
| Enterprise | **$199** | 1,500 | ~1,500 photos or 50–100 × 15s videos | 16/mo | 15s | ✓ |

**3-day free trial · 10 free credits · card required (stated as anti-abuse) · Stripe · top-ups at 24¢/credit.**

*All plans include:* unlimited pre-made influencers, photos/videos/lip-sync, edits & background changes, try-on & hold-products, motion transfer, the Influencer Builder.

### 1.7 Their sharpest marketing weapon — the "slop" comparison

| **Generic AI output** | **The Influencer AI** |
|---|---|
| Different face every prompt | Same persona, every output |
| Last-gen model, six months stale | Latest frontier models |
| Plastic skin, dead eyes, eight fingers | Real textured skin, lifelike eyes, all five fingers |
| Looks like a stock photo | Looks shot, not generated |
| Content nobody asked for | Content the audience saves and shares |

Concrete, visual, slightly funny, and it makes every competitor look like the left column. **We should build the equivalent table — but ours compares *studios* to an *operating system*, not slop to quality.**

They also run **head-on comparison pages** ("Higgsfield Alternative", "Arcads Alternative") — cheap, high-intent SEO.

### 1.8 What they cannot do

**They stop at the download.** No connected accounts. No scheduling. No autopilot. No approval queue. No verified publish. No analytics. No brand brief. No product ingestion. No spend ledger. No multi-persona differentiation. Video capped at 15 seconds, and the cap is a paywall.

---

## 2. Teardown B — higgsfield.ai/ai-influencer

**Hero:** "Create Your AI Influencer" / "Turn your ideas into a 24/7 content machine… without ever facing a camera."
**Scale:** 25M+ claimed users, 5,000+ businesses, 40+ footer tool pages.

**Soul ID** — trains on **20+ photos in 3–5 minutes**, then holds identity across every generation. A trained embedding, not prompt conditioning. **This is the strongest consistency tech in the market.**

| Capability | Notes | Us |
|---|---|---|
| Soul ID trained identity | 20+ imgs, 3–5 min | ❌ |
| Motion Transfer | Reference video → choreography | ❌ |
| Detail Tuning | Scars, tears, posture, heterochromia, skin texture | ⚠️ |
| Brand Collabs | Product insertion with correct lighting | ✅ |
| Scenario Placement | Outfit/makeup/setting/health-state | ✅ |
| Apps | Style Snap, Plushies, Angles, Recast, Transitions | ❌ |

**Pricing (annual):** Starter $15 / 200 credits · Plus $39 / 1,000 · Ultra $99 / 3,000. Top-ups ~$5/100 credits. **Credits don't roll over; top-ups expire in 90 days.**

**Weakness:** a generation studio with no distribution, marketed to a scattered creative audience (their influencer studio sits next to Elf/Beetle/Amphibian character categories). Not a business tool.

---

## 3. Teardown C — createpersona.ai

**Hero:** "Create AI Influencers. Generate Content 10x Faster." **CTA:** free, no card.

**Features:** avatar creator ("100% face consistency"), UGC video with lip-sync, product/lifestyle photos, **"Recreate any Instagram shot"** (paste an IG link), auto-schedule to **Instagram only** (TikTok & X "coming soon"), 2K/4K, "No watermarks" on all tiers.

**Pricing:** Starter $29 / 150 credits (~50 images *or* ~2 videos) / 3 influencers · Pro $49 / 350 / 7 · Creator $79 / 700 / unlimited + API.

**Credibility problems (exploitable):**
- Testimonials read as fabricated — "Sarah Mitchell, Glow Beauty… engagement up 340%", "Marcus Chen, TechGadgets DTC", "Emily Rodriguez, FitLife". Composite names, round-number lifts, no linkable accounts.
- `/features` returns generic boilerplate ("Collaboration Tools", "Analytics & Insights") that contradicts the specific homepage copy — those sections are aspirational.
- `/pricing` **404s**.
- "Recreate any Instagram shot" invites replication of third-party copyrighted photographs, as a headline feature.
- "No watermarks" as a tier benefit ages badly — see §7.3.

**Their pricing cannot serve our product.** One PersonaGen persona on autopilot at 6 posts/day = **180 posts/month**. Their top $79 tier is 233 images — one persona, images only, then you're out. Five personas = 900 posts/month, which does not exist on their sheet at any price.

---

## 4. Terminology audit — this is the fix the product needs most

The niche has settled on a vocabulary. We are using an agent-framework vocabulary from a different category. Every one of these appears in user-facing UI today.

### 4.1 Rename table

| Ours today | Where | **Industry standard** | Why it matters |
|---|---|---|---|
| **Agent** | `Agent` type, `agents` table, `AgentRoster`, `agentId`, **"Agent Generator"** page heading | **Persona** (secondary: *AI influencer*, *creator*) | All three competitors say persona/influencer. "Agent" reads as devtools, not marketing. Our own route is `/personas/[agentId]` — we're already inconsistent with ourselves. |
| **Soul** | `agent.soul`, "Soul (Personality & Voice)" | **Personality & Voice** (field), or *Persona brief* | "Soul" is charming internally and meaningless to a buyer. |
| **Market** | `agent.market` (JSON blob holding the whole profile) | **Persona profile** | A column named `market` holding appearance + psychology is a maintenance hazard and an onboarding hazard. |
| **Appearance fields** | `APPEARANCE_FIELDS` | **Traits** | The word the entire category uses. Non-negotiable. |
| **Reference kit** / `ugc_reference_kit` | persona page | **Locked identity** (user-facing) / *identity set* (internal) | "Kit" undersells it. "Locked" is the promise buyers respond to. |
| **Character ref** | `ugc_character_ref` | **Private model** (once trained) / *master image* | Higgsfield says master image; theinfluencer says private model. |
| **UGC pack** | `generateUgcPack` | **Post** / *asset* | |
| **Skills & Capabilities**, **Tools**, **Heartbeat** | generator, agent config | *(remove from UI)* | Agent-framework jargon with no meaning in this niche. |
| **Overseer**, **Hermes daemon**, **runtime_owner** | types, README | *(internal only — never surface)* | |
| **Blueprint** | engine actions | **Template** | |
| **Autonomy level** | persona config | **Autonomy level** ✅ keep | Genuinely ours, genuinely good, nobody else has it. |
| **Brand brief** | route | **Brand brief** ✅ keep | Correct and differentiating. |
| — | not present | **Batch**, **Try-on**, **Motion transfer**, **Lip-sync**, **Frontier models**, **Commercial rights**, **Best Fit**, **Regenerate**, **Lock in** | Terms buyers now search for and expect to see. |

**Recommendation:** keep `agent*` as the database/internal identifier (renaming tables is risk with no user benefit), but **purge "agent", "soul", "skills", "tools", "heartbeat", "overseer" from every user-visible string.** Start with the `Agent Generator` H1 — that heading alone signals wrong category to every visitor.

### 4.2 Phrases to adopt verbatim (proven in-market)

- "Same face on every photo, video, try-on, and motion clip you ship."
- "No prompt writing required."
- "Set the ones that matter, leave the rest on Best Fit."
- "Regenerate as many times as you want, then lock in the look you love."
- "Yours forever. Full commercial rights."
- "Looks shot, not generated."

---

## 5. UI / UX standards audit — where our interface is off-standard

You asked specifically that our interface not be far off the industry's. Here is exactly where it is.

### 5.1 The traits problem (P0)

**Ours today** ([persona-profile.ts:67](../../personagen-svelte/src/lib/persona-profile.ts#L67)): nine **free-text inputs** with `e.g.` placeholders —
`Ethnicity / heritage` → *"e.g. Vietnamese, Nigerian, Brazilian, Korean-American"*, `Wardrobe / outfit` → *"e.g. cream linen sets, minimal gold jewelry"*, `Hairstyle` → *"e.g. long loose waves / sleek bun / bald"* …

**That is prompt writing.** Their headline promise is that you never have to do it. A user comparing the two screens will conclude ours is the technical/expert tool and theirs is the product — the exact opposite of what we want.

**Trait dimension coverage:**

| Trait | theinfluencer.ai | PersonaGen today | Action |
|---|---|---|---|
| Gender | chips (F/M) | select, on a different tab | move into Traits |
| Ethnicity | chips + `+5 more` | **free text** | → chips |
| **Age** (of the persona) | chips 25–29, 30–35, 36–44 `+4` | **❌ MISSING** — our `ageRanges` is the *audience's* age, a different thing entirely | **add** |
| **Skin tone** | chips Fair/Light, Medium, Dark | **❌ MISSING** | **add** |
| Eye colour | chips + `+3` | free text | → chips |
| **Body** | chips Athletic, Slim, Curvy `+3` | **❌ MISSING** | **add** |
| **Hair length** | chips Long, Medium, Short `+3` | ❌ conflated into "Hairstyle" | **split** |
| Hair style | chips Curly, Wavy, Straight `+3` | free text | → chips |
| Hair colour | chips + `+5` | free text | → chips |
| Wardrobe / outfit colours / headwear / distinctive features / styling | *(handled at generation time)* | free text | keep as **Advanced**, collapsed |

**Four missing dimensions (persona age, skin tone, body, hair length) and five that need converting from text to chips.**

### 5.2 Component spec — `TraitPicker.svelte`

To be built as a reusable component, used in the persona wizard and the persona edit page.

```
┌─────────────────────────────────────────────────────────────┐
│ ● PICK THE TRAITS · STEP 1 OF 3                             │
├─────────────────────────────────────────────────────────────┤
│ GENDER      (Best Fit) [Female] [Male]                      │
│ ─────────────────────────────────────────────────────────── │
│ ETHNICITY   (Best Fit) [Mixed] [Hispanic] [White] [ +6 ⌄ ]  │
│ ─────────────────────────────────────────────────────────── │
│ AGE         (Best Fit) [25–29] [30–35] [36–44] [ +4 ⌄ ]     │
│ …                                                            │
│                                                              │
│ ⟳ Regenerate the preview as many times as you want,          │
│   then lock in the look you love.                            │
│                                              ▸ Advanced (5)  │
└─────────────────────────────────────────────────────────────┘
```

Behaviour contract:
- Every row **defaults to `Best Fit`** — a real selectable chip, not an empty state. Zero required input to reach a preview.
- `Best Fit` values are resolved by our existing `generate_persona_profile` call, which already infers ethnicity from the persona's name — **we do this better than they do and currently show none of it.**
- `+N more` expands the row inline. Never a `<select>`. `<select>` is the single most off-standard control in our current UI.
- Chips are keyboard-navigable, `role="radiogroup"`, arrow keys move, Enter selects.
- Advanced group (wardrobe, outfit colours, headwear, distinctive features, styling) stays free text, collapsed by default.

Styling against our existing tokens ([app.css](../../personagen-svelte/src/app.css)): unselected `1px solid var(--border)` on `var(--surface)`; selected `2px solid var(--accent)` + `var(--accent-soft)` fill + 600 weight; overflow chip `1px dashed var(--border-strong)`; labels `var(--text-sm)`, uppercase, `letter-spacing: .08em`, `var(--text-dim)`; hairline row dividers; `border-radius: 999px`; `transition: all .15s ease`.

### 5.3 The preview-and-lock loop (P0)

**Ours today:** a 3-step wizard — Identity → Persona → **Review & Create** ([generator](../../personagen-svelte/src/routes/(portal)/generator/+page.svelte#L312)) — that commits on **text**. The face is generated *after* creation, on a different page.

**Standard:** you never commit until you have seen the face and approved it.

**Target flow:**

| # | Step | Time to show | Content |
|---|---|---|---|
| 01 | **Pick the traits** | `~30 SEC` | Ten guided chip rows, all defaulted to Best Fit |
| 02 | **See the preview** | `8–30 SEC` | Live render + `● NAME · GENERATED IN 8S` badge + *"Don't love the look? Regenerate."* — unlimited free regens |
| 03 | **Lock them in** | `YOURS FOREVER` | Confirm → runs our 5-stage identity set → **"Locked. Same face on every photo, video and clip you ship."** |
| 04 | **Ground it in your brand** ★ | `~60 SEC` | *(ours alone)* attach brand brief, scrape products, set niche/angle |
| 05 | **Connect & set autonomy** ★ | `~90 SEC` | *(ours alone)* connect accounts, choose Advisor / Semi / Fully autonomous, set cadence |

Steps 04–05 exist in no competitor product. **Presenting them as steps 4 and 5 of the same wizard is how we show, in ten seconds, that we do more than they do.**

Show a real elapsed-time badge on every generated asset. We have the timings; surfacing them is nearly free and reads as confidence.

### 5.4 Other off-standard interface gaps

| Gap | Standard | Ours |
|---|---|---|
| **Pre-made personas** | Unlimited, on every tier — instant activation | ❌ none — every user starts from a blank form |
| **Batch generation** | 32 photos/prompt; "100 reels in minutes" | ⚠️ `batch_generate` exists in the engine, not surfaced as a first-class UI |
| **Aspect ratios** | 5, explicit | ⚠️ resolved internally, not user-facing |
| **Edit with history** | Prompt-based edit, undo/redo, originals preserved | ⚠️ `refine-post` + `restore-kit-stage` exist — no undo/redo UI |
| **Elapsed-time badges** | On every asset and step | ❌ |
| **Gallery / proof** | Same face across 6–12 labelled scenes (Studio, Street, Café, Travel, Gym, Night out) | ❌ |
| **Comparison table** | "Generic slop vs us" | ❌ |
| **Aspirational free tier** | 3-day trial + 10 free credits | ❌ — we demand the user's own fal.ai key before anything renders ([generate.ts:213](../../personagen-svelte/src/lib/server/content/generate.ts#L213)) |

---

## 6. Full parity matrix

✅ shipped · ⚠️ partial · ❌ absent · 🏆 clearly ahead of all three

### 6.1 Persona creation & identity

| Capability | theinfluencer | Higgsfield | createpersona | **PersonaGen** |
|---|---|---|---|---|
| **Trait chip picker** | ✅ 10 fields | ✅ visual | ✅ | ❌ free text — **P0** |
| **"Best Fit" defaults** | ✅ | ⚠️ | ⚠️ | ❌ **P0** |
| **Preview → regenerate → lock** | ✅ | ✅ | ✅ | ❌ **P0** |
| **Trained identity / private model** | ✅ AI Clone | ✅ Soul ID | ⚠️ claimed | ❌ multi-ref only — **P0** |
| **Pre-made personas** | ✅ unlimited | ✅ | ❌ | ❌ **P1** |
| Clone from user's own photos | ✅ 8–12 | ✅ 20+ | ✅ | ❌ **P1** |
| Multi-stage identity set | ❌ | ❌ | ❌ | 🏆 5 stages, restorable |
| Backstory / psychology / ownable angle | ⚠️ | ❌ | ⚠️ | 🏆 archetype + psych profile + POV |
| **Cross-persona differentiation** | ❌ | ❌ | ❌ | 🏆 forced distinct look **and** angle across the roster |
| Voice identity | ⚠️ | ⚠️ | ⚠️ | 🏆 accent/nationality-matched, seeded |
| Name→ethnicity coherence | ❌ | ❌ | ❌ | 🏆 |
| Per-platform bios + handle candidates | ❌ | ❌ | ❌ | 🏆 identity kit |

### 6.2 Content generation

| Capability | theinfluencer | Higgsfield | createpersona | **PersonaGen** |
|---|---|---|---|---|
| Photos from prompt/reference | ✅ | ✅ | ✅ | ✅ |
| **Batch (32/prompt)** | ✅ | ✅ | ⚠️ | ⚠️ engine-only |
| Talking-head lip-sync | ✅ | ⚠️ | ✅ | ✅ OmniHuman v1.5 |
| Video length | 3–15s (paywalled) | ~5–10s | ~5s | ✅ 5s + **multi-shot cinematic** |
| Multi-shot storyboarded video | ❌ | ⚠️ | ❌ | 🏆 director → storyboard → parallel stills → Kling |
| **Hook-quality gate** | ❌ | ❌ | ❌ | 🏆 weak scripts killed **before** paying for video |
| **Try-on** | ✅ | ⚠️ | ❌ | ❌ **P1** |
| **Motion transfer** | ✅ 4–30s | ✅ | ❌ | ❌ **P2** |
| **40+ languages** | ✅ | ⚠️ | ❌ | ❌ **P1** |
| Edit w/ undo, originals kept | ✅ | ⚠️ | ⚠️ | ⚠️ no UI |
| Upscaler | ✅ | ✅ | ⚠️ | ❌ |
| Model choice + $/call shown | ❌ | ❌ | ❌ | 🏆 full catalog, tiered, priced in-UI |

### 6.3 Distribution & operations — uncontested ground

| Capability | theinfluencer | Higgsfield | createpersona | **PersonaGen** |
|---|---|---|---|---|
| Platforms published to | **0** (download) | **0** (download) | **1** (Instagram) | 🏆 **13** ([platforms.ts](../../personagen-svelte/src/lib/platforms.ts#L15)) |
| Scheduling calendar | ❌ | ❌ | ✅ basic | 🏆 Day/Week/Month + persona rail |
| **Autonomy levels** | ❌ | ❌ | ❌ | 🏆 Advisor / Semi / Fully |
| **Autopilot** | ❌ | ❌ | ⚠️ batch weekly | 🏆 tz-aware slots, idempotent, cost-capped, dead-letters after 3 fails |
| Approval queue | ❌ | ❌ | ❌ | 🏆 |
| **Verified publish** | ❌ | ❌ | ❌ | 🏆 never "published" without platform confirmation |
| Honest deletion | ❌ | ❌ | ❌ | 🏆 manual-delete notice + permalink |
| Analytics | ❌ | ❌ | ⚠️ claimed | ✅ views/likes/comments/shares |
| **Per-persona spend ledger** | ❌ | ❌ | ❌ | 🏆 every generation costed |

### 6.4 Brand grounding — uncontested

| Capability | Any competitor | **PersonaGen** |
|---|---|---|
| Brand brief (mission, voice, traits, audience, pain points, competitors) | ❌ | 🏆 |
| **Product scraping from a store URL** | ❌ | 🏆 |
| UGC guideline presets | ❌ | 🏆 |
| Multi-brand / multi-client | ⚠️ implied | ✅ |

### 6.5 Commercial surface — we are at zero

| Capability | theinfluencer | Higgsfield | createpersona | **PersonaGen** |
|---|---|---|---|---|
| **Landing page** | ✅ | ✅ | ✅ | ❌ root redirects to `/dashboard` ([+page.svelte:9](../../personagen-svelte/src/routes/+page.svelte#L9)) |
| **Pricing page** | ✅ | ✅ | ⚠️ 404 | ❌ |
| **Billing** | ✅ Stripe | ✅ | ✅ | ❌ "coming soon" ([settings:1069](../../personagen-svelte/src/routes/(portal)/settings/+page.svelte#L1069)) |
| **Free trial, no keys** | ✅ 3-day + 10 credits | ✅ | ✅ | ❌ demands user's fal key |
| Gallery | ✅ | ✅ | ✅ | ❌ |
| SEO tool pages | ✅ ~14 | ✅ 40+ | ✅ 5 | ❌ |
| Competitor-alternative pages | ✅ | ⚠️ | ❌ | ❌ |
| Legal pages | ✅ | ✅ | ✅ | ❌ |
| Affiliate program | ✅ | ✅ | ✅ | ❌ |
| Teams | ⚠️ | ✅ | ⚠️ | ❌ |

---

## 7. Viability assessment

### 7.1 The market is real and it is stratifying

Four credible competitors, one with 25M+ users, another with 10,000+ paying creators and real third-party press. Demand is proven. The tiers:

- **Toy** ($0–19) — hobbyists. Race to zero. Avoid.
- **Creator** ($19–99) — where all three fight. Credit-metered, undifferentiated, low switching cost.
- **Operator** ($200–2,000+) — brands and agencies needing volume, consistency, approval, publishing, audit trail. **Empty. Our architecture already lives here.**

### 7.2 Unit economics — our structural advantage

At verified provider costs ([pricing.ts](../../personagen-svelte/src/lib/pricing.ts)): image **$0.08** · standard video **$0.61** · cinematic **$1.95** · talking head **$0.81**.

One persona, 6 posts/day, 30 days = **180 posts**:

| Mix | Our provider cost |
|---|---|
| All images | ~$15/mo |
| 50/50 image + video | ~$62/mo |
| Heavy cinematic | ~$200/mo |

Retail comparison at the same volume:

| Vendor | Cost of 180 images/mo | Cost of 90 videos/mo |
|---|---|---|
| theinfluencer.ai | ~$39 (Creator, 250cr) | **not purchasable** — top tier is 50–100 × 15s at $199 |
| createpersona | ~$79 (Creator, 233 imgs) | **not purchasable** — 10 videos max |
| Higgsfield | ~$39–99 + top-ups | expensive, credits expire |
| **PersonaGen** | **~$15 cost** | **~$55 cost** |

**Defensible offer:** **$299/mo per brand — 10 personas, unlimited posts, 13 platforms, you approve everything.** ≈ $30/persona at 180 posts each ≈ **$0.17/post**, against a $15–200 cost base across the account. Margin holds at every mix, and no credit-metered competitor can match it without cannibalising their own price list.

**But we capture none of it today** — no billing, and users bring their own keys. BYO-key is an excellent *enterprise* option and a fatal *default*.

### 7.3 Risk register

| Risk | Severity | Assessment |
|---|---|---|
| **No commercial surface** | **CRITICAL** | The best product loses to the worst product with a signup button. Everything else in this document is secondary to this. |
| **Synthetic-content disclosure regulation** | **HIGH → opportunity** | EU AI Act transparency obligations for synthetic/deepfake content are understood to apply from **2 Aug 2026 — one week out.** *Verify current text with counsel before publishing claims.* This **inverts** the market: createpersona sells "No Watermarks" as a tier benefit; we already burn an `AI GENERATED` marker into video ([video.ts:145](../../personagen-svelte/src/lib/server/video.ts#L145)). Notably, theinfluencer.ai already answers the ethics question in their FAQ and *recommends* disclosure — the smartest player is hedging. **We should lead with it.** |
| **Platform ToS / bans** | **HIGH** | Meta and TikTok restrict undisclosed synthetic personas. Mitigation is disclosure + brand-owned accounts, not stealth. **The README's stealth account-factory / residential-node architecture is the wrong story for a legitimate B2B product and must be de-emphasised in all public material.** |
| **IG auto-posting reality** | MED-HIGH | Real IG publishing needs a Business/Creator account linked to a Facebook Page. createpersona's "auto-post to Instagram" carries the same constraint unmentioned. Stay honest; it's a trust asset. |
| **Consistency gap vs Soul ID / AI Clone** | **HIGH** | Two of three competitors ship trained identity. Directly attackable in a side-by-side. **P0.** |
| **Terminology mismatch** | MED-HIGH | Cheap to fix, expensive to leave. A visitor who doesn't recognise the category bounces. |
| **Zernio single-vendor dependency** | MED | 13 platforms through one vendor whose pricing already changed once (verified 2026-07-08). |
| **Model cost drift** | LOW | Already abstracted behind `pricing.ts` + `UGC_PRICING_JSON`. |

### 7.4 Verdict

**Viable, with a defensible and currently unoccupied position — conditional on shipping a commercial surface and adopting the category's front end.**

Product risk is largely retired: the operations layer is genuinely ahead of all three competitors and would take each of them 6–12 months to replicate. The remaining risk is entirely go-to-market and presentation. We are competing against a 25M-user incumbent and a 10,000-creator benchmark while having **no front door, no price, no free trial, and a vocabulary from a different industry.**

---

## 8. Gap closure plan

### P0 — blocking launch (weeks 1–4)

1. **`TraitPicker.svelte`** — ten chip rows, Best Fit defaults, `+N more` inline expansion, Advanced collapsed. Add the four missing dimensions (persona age, skin tone, body, hair length); split hair length from hair style. Spec in §5.2.
2. **Preview → regenerate → lock wizard.** Rebuild the generator around the five steps in §5.3. Elapsed-time badges throughout.
3. **Terminology purge.** Remove *agent, soul, skills, tools, heartbeat, overseer* from every user-visible string. Start with the `Agent Generator` H1. §4.1.
4. **Landing page + pricing + gallery.** §9.
5. **Trained identity ("Locked Identity").** LoRA training on fal, fed by the reference kit we already generate. **Our onboarding beats theirs structurally: they make the user upload 8–20 photos; we *generate* a consistent set from a single approved preview.** That is a real, ownable advantage — sell it.
6. **Managed keys + Stripe billing + free first run.** Platform keys with metered markup as default; BYO-key becomes a Pro/agency toggle. 10 free generations, no key, no card until the paywall.

### P1 — parity (weeks 5–10)

7. **Pre-made personas library** — highest-ROI activation feature in the category; every competitor has one.
8. **Clone from user photos** (8–12 uploads) — completes the two-path standard.
9. **Multi-language + fluency.** theinfluencer ships 40+; it is table stakes, not a differentiator. Pairs with our accent-matched TTS. *One persona → eight markets* is a story none of them tell well.
10. **Virtual try-on** — garment upload + category.
11. **Batch generation surfaced** as first-class UI (32/prompt), with aspect-ratio control.
12. **Recreate-a-look** — paste URL/upload → vision decompose → rebuild with our persona. Frame as *"recreate a look/style,"* never *"clone this creator's photo"* — sidesteps the exposure createpersona walked into.
13. **SEO tool pages** — UGC Script Generator, TikTok Hook Generator, IG Caption/Bio/Hashtag, plus **"Higgsfield Alternative"** / **"The Influencer AI Alternative"** comparison pages. We already have the LLM plumbing; these are thin route wrappers with large funnel value.
14. **Legal pages** + an **AI Disclosure Policy** page nobody else has.

### P2 — extend the lead (weeks 11+)

15. Motion transfer · 16. Edit history with undo/redo · 17. Image upscaler · 18. Teams/agency workspaces (required for $299+) · 19. Comment & DM engagement — the honest version of "auto-growing" · 20. Second publishing vendor to de-risk Zernio.

---

## 9. Landing page blueprint

**Design direction:** theinfluencer.ai's *structure and restraint* (light, generous whitespace, chip-and-card components, time estimates, comparison table), Higgsfield's *confidence* in the hero. Use our existing tokens — accent `#7c6aed`, cyan `#0ea5e9`, dark `#0b0713`, Playfair Display over Inter ([app.css](../../personagen-svelte/src/app.css)) — so the marketing page and the product are visibly the same object.

### Section order

1. Hero (live trait-picker preview as the hero visual — *show the product doing its trick*)
2. Platform strip — 13 marks, our loudest differentiator
3. How it works — **five** steps with time estimates (theirs stops at three)
4. Comparison table — studios vs schedulers vs **operating system**
5. Feature deep-dives (§9.2)
6. Gallery — same face, 12 labelled scenes
7. Use cases — Brands · Agencies · Sellers · Creators
8. Trust & disclosure — the section nobody else has
9. Pricing — **per brand, not per credit**
10. FAQ
11. Footer — product, free tools, comparisons, company, legal, social

### 9.1 Hero

> **Eyebrow:** The AI persona platform that runs the account
>
> **H1:** Create your AI personas. We'll run their accounts.
>
> **Sub:** Pick traits, lock the face, and let your personas post to 13 platforms on their own — grounded in your real products, approved by you, every dollar accounted for.
>
> **CTA:** Create Your Persona — Free · *No credit card. No API keys. First persona live in 4 minutes.*
> **Secondary:** See the gallery →

Everyone in this market sells *making a face*. The second sentence of our H1 is the only claim on the page that none of the three can print.

### 9.2 Feature blocks

| # | Heading | Copy |
|---|---|---|
| 1 | **Pick the traits. Lock the face.** | Ten guided fields, everything else on Best Fit. No prompt writing. Regenerate the preview until you love it, then lock it in — same face on every photo, video and clip you ship. |
| 2 | **Publishes to 13 platforms. Proves it landed.** | Instagram, TikTok, YouTube, Facebook, X, Threads, LinkedIn, Bluesky, Pinterest, Reddit, Google Business, Telegram, Snapchat. We never mark a post published until the platform confirms it. |
| 3 | **It knows your actual business.** | Point it at your store. It reads your products, prices and photos, and builds every persona's angle around what you actually sell. |
| 4 | **Three levels of autonomy. Your call.** | Advisor suggests. Semi-autonomous drafts and waits for you. Fully autonomous runs inside your guardrails. Per persona, changeable any time. |
| 5 | **No two personas look or sound alike.** | Run ten and they won't converge. Every new persona is checked against your whole roster — look, angle, audience, voice — and forced to be different. |
| 6 | **Every cent, on the record.** | Per-persona, per-post spend by provider. Pick your quality tier and see the cost before you spend it. **No credits. No expiry. No guessing.** |

### 9.3 Comparison table (our answer to their "slop" table)

| | Generation studios | Schedulers | **PersonaGen** |
|---|---|---|---|
| Consistent face | ✓ | ~ | ✓ |
| Video with lip-sync | ✓ | ✓ | ✓ |
| Knows your products | — | — | ✓ |
| Publishes for you | — | 1 platform | **13 platforms** |
| Confirms it published | — | — | ✓ |
| You approve before it posts | — | — | ✓ |
| Runs on a schedule, unattended | — | — | ✓ |
| Shows you the cost | — | credits | **exact USD** |
| Ends at | a download | Instagram | **your analytics** |

### 9.4 Trust & disclosure — our unique section

> **Built for brands that have to answer for what they post.**
> Every generated video carries an AI-generated marker. Every post is approved before it goes out unless you say otherwise. Every publish is verified against the platform — and where a platform makes deletion impossible, we tell you plainly instead of pretending. Disclosure rules for synthetic content are arriving. We built for them first.

Competitors sell **"No Watermarks"** as a tier benefit. Put that contrast on the page.

### 9.5 Pricing frame

Price **per brand, not per credit** — the structural advantage, and it reframes every comparison.

| | **Studio** | **Brand** ★ | **Agency** |
|---|---|---|---|
| $/mo | 79 | **299** | 899 |
| Personas | 3 | 10 | Unlimited |
| Posts | 500/mo | **Unlimited** | **Unlimited** |
| Platforms | 13 | 13 | 13 |
| Brand briefs | 1 | 3 | Unlimited |
| Autonomy | Advisor + Semi | All three | All three |
| Video | Standard + lip-sync | + cinematic multi-shot | + priority queue |
| Extras | — | Spend ledger, verified publishing, approval queue | Teams, BYO keys at cost, API, dedicated manager |

Comparison line for the pricing section:
> *"The best-known tool in this category gives you 250 photos a month for $39. One PersonaGen persona posts 180 times a month — and on Brand you run ten of them, with no credit meter at all."*

### 9.6 FAQ (must answer — they all do)

What is an AI persona? · Commercial rights (**"Yours forever"**) · How locked identity works and why it beats prompting · Which platforms are live **today** · **Why we don't sell credits** · Are AI personas allowed on these platforms (honest answer + our disclosure stance) · Can I clone myself? · Can I import an existing account? · What happens if a generation fails (dead-lettering) · Cancel/pause.

---

## 10. Bottom line

**After the image exists, we beat all three — and it isn't close.** Brand grounding, 13-platform verified publishing, autonomy levels, approval queue, spend ledger, cross-persona differentiation: none of them have any of it, and it is the expensive half of the problem.

**Before the image exists, we are behind all three** — on trait UX, the preview-and-lock loop, trained identity, pre-made personas, try-on, motion, and languages. And we speak the wrong language, have no front door, and cannot take money.

The good news is the ordering: **everything in P0 is presentation and packaging over a product that already works.** Adopt the category's vocabulary and interface, put a door on the building, and the operations layer we already own becomes the thing nobody can answer.

> **Everyone else sells you a face. We run the account.**
