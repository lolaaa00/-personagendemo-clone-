# PersonaGen — Competitive Teardown, Gap Analysis & Viability Assessment

**Date:** 2026-07-25
**Subjects:** `createpersona.ai` ("Persona AI"), `higgsfield.ai/ai-influencer` (Higgsfield AI Influencer Studio)
**Purpose:** establish what we must match, what we already beat, and what our landing page must claim.

---

## 0. Executive verdict

The two competitors sit at **opposite ends of the same market**, and neither occupies the position PersonaGen was actually built for.

| | Higgsfield | createpersona.ai | **PersonaGen** |
|---|---|---|---|
| What it really is | A **creative studio** — best-in-class character consistency, no distribution | A **thin SaaS wrapper** — decent packaging, shallow product | An **operations platform** — brand-tied personas that run themselves |
| Ends at | Download button | Instagram scheduler | Verified multi-platform publish + analytics + spend ledger |
| Scale | 25M+ claimed users | Unknown, likely tiny | Pre-launch |
| Real moat | Soul ID (trained identity) | None | Autonomy + brand grounding + publish verification |

**The strategic read:** Higgsfield wins on *image quality and identity lock*. createpersona wins on *packaging and go-to-market*. **Nobody wins on "the persona actually runs a business account without a human babysitting it."** That is our lane, and our codebase is already ~70% of the way there while our marketing surface is at 0%.

**The single most dangerous gap is not a feature — it is that `/` redirects to `/dashboard`. We have no landing page, no pricing, no signup funnel, no billing.** ([+page.svelte:9](../../personagen-svelte/src/routes/+page.svelte#L9))

---

## 1. Teardown A — createpersona.ai

### 1.1 What they sell

**Hero:** "Create AI Influencers. Generate Content 10x Faster."
**Sub:** "Build consistent AI influencers with our AI avatar creator, generate photos & UGC videos, recreate any Instagram shot, and schedule posts—all from one platform. No models, no photoshoots, no delays."
**CTA:** "Create Your First AI Influencer — Free" · no credit card required

**Three-step narrative:** Create Your Influencer → Generate Content → Schedule & Scale.

### 1.2 Feature inventory

| Feature | Their claim |
|---|---|
| AI influencer creator | "100% face consistency across all content"; from scratch or from reference photos |
| UGC video generator | Talking-head with lip-sync audio; Reels/TikTok/ads; **product-in-hand** demos |
| Product & lifestyle photos | Text-prompt product shots |
| **Recreate any Instagram shot** | Paste an IG link → replicate exact scene, pose, styling with your influencer |
| Auto-schedule & post | Content calendar, batch weekly generation, **Instagram only** (TikTok & X "coming soon") |
| Resolution | 2K on Starter, 4K on Pro/Creator |
| Watermarks | "No watermarks" — sold as a *feature* on every tier |

**Use cases marketed:** DTC/e-commerce, agencies, creators, affiliate marketers, course creators, faceless accounts.

### 1.3 Pricing and the margin they're taking

| Tier | Price/mo | Credits | Yield | Influencers | Extras |
|---|---|---|---|---|---|
| Starter | **$29** | 150 | ~50 images **or** ~2 videos | 3 | HD 2K, 1GB, email support |
| Pro | **$49** | 350 | ~116 images **or** ~5 videos | 7 | 4K, 3GB, custom branding |
| Creator | **$79** | 700 | ~233 images **or** ~10 videos | Unlimited | 4K, 5GB, **API access**, dedicated manager |

**Implied retail rate vs. our verified provider cost** ([pricing.ts](../../personagen-svelte/src/lib/pricing.ts)):

| Unit | Their retail (Starter) | Their retail (Creator) | Our true cost | Markup |
|---|---|---|---|---|
| Image | $0.58 | $0.34 | **$0.08** (nano-banana-2) | **4×–7×** |
| Video | $14.50 | $7.90 | **$0.61** (Kling o3 std + TTS + still) | **13×–24×** |
| Cinematic multi-shot | n/a — can't do it | n/a | $1.95 | — |
| Talking head ~5s | included in "video" | | $0.81 (OmniHuman v1.5) | |

**This is the most important commercial finding in the document.** Their entire pricing architecture assumes low-volume, hand-driven creation. **A single PersonaGen persona on autopilot at 6 posts/day = 180 posts/month.** On their *top* $79 tier that is 233 images — one persona, images only, no video, and you're out. Five personas at our default cadence = 900 posts/month, which does not exist anywhere on their price sheet at any price.

> **They cannot sell the product we built. Their unit economics forbid it.**

### 1.4 Credibility problems (exploitable)

- **Testimonials read as fabricated.** "Sarah Mitchell, Marketing Director at Glow Beauty… engagement is up 340%"; "Marcus Chen, Founder at TechGadgets DTC"; "Emily Rodriguez, Social Media Manager at FitLife." Generic composite names, round-number lift claims, no linkable accounts, no screenshots.
- **`/features` is boilerplate.** The deep-link features page returns generic template copy ("Advanced AI Generation", "Collaboration Tools", "Analytics & Insights") that does not match the specific, real-sounding homepage copy — a strong signal those sections are aspirational, not shipped.
- **`/pricing` 404s.** Pricing exists only as homepage cards.
- **"Recreate any Instagram shot"** invites users to replicate other people's copyrighted photographs. That is a legal exposure they are advertising as a headline feature.
- **"No watermarks" as a selling point** ages badly (see §5.3).

### 1.5 What they do genuinely better than us today

1. **A funnel exists.** Landing → free signup → credits → paywall. Ours: none.
2. **Free-tool SEO play.** IG Bio Generator, IG Caption Generator, IG Hashtag Generator, TikTok Hook Generator, UGC Script Generator — five keyword-bait pages feeding the funnel. We have zero SEO surface.
3. **Zero-config first run.** No API keys required. Ours refuses to generate anything until the user pastes a fal.ai key ([generate.ts:213](../../personagen-svelte/src/lib/server/content/generate.ts#L213)).
4. **Instagram-shot recreation.** We have vision-based *appearance* reading ([engine:2498](../../personagen-svelte/src/routes/api/engine/+server.ts#L2498)) but no "paste a link, rebuild that scene" flow.
5. **A gallery.** Proof-of-output is the #1 conversion asset in this category and we have none.
6. **Legal/trust page furniture.** Privacy, Terms, Cookie, Refund policies. Affiliate program. Discord.

---

## 2. Teardown B — higgsfield.ai/ai-influencer

### 2.1 What they sell

**Hero:** "Create Your AI Influencer"
**Sub:** "Turn your ideas into a 24/7 content machine. Create a consistent digital influencer and generate endless viral videos for TikTok, Reels, and Shorts without ever facing a camera."
**Steps:** Create Your Star → Make it Move → Generate & Dominate (**download** ready-to-post content).

### 2.2 The one thing that genuinely beats us: Soul ID

Soul ID **trains on 20+ photos of the character in 3–5 minutes** and then locks that identity across every subsequent generation — new outfits, scenes, angles, lighting. It is a trained identity embedding, not prompt conditioning.

**Our approach is architecturally weaker.** PersonaGen holds consistency through a 5-stage reference kit (character sheet → full body → side profiles → face close-up → feature grid) fed as multi-image references to nano-banana-2 edit ([generate-reference-kit](../../personagen-svelte/src/routes/api/agent/%5BagentId%5D/generate-reference-kit/+server.ts), [models.ts](../../personagen-svelte/src/lib/models.ts)). This is genuinely good — good enough that we flag single-reference models as `multiRef: false` so they can't silently drop the sheet — but **reference conditioning drifts where a trained ID does not.** Over hundreds of autopilot posts, drift compounds.

**This is our #1 technical gap and it is the one competitors will point at.**

### 2.3 Their other differentiators

| Capability | What it does | Do we have it? |
|---|---|---|
| **Motion Transfer** | Upload a reference video → transfer exact choreography onto your character | ❌ |
| **Detail Tuning** | Prompt-level micro-edits: scars, tears, posture, heterochromia, skin texture | ⚠️ partial — appearance fields, no live tuning |
| **Brand Collabs** | Insert brand products with correct lighting → shoppable posts | ✅ product photo compositing |
| **Scenario Placement** | Any setting, outfit, makeup, health-state | ✅ scene/topic steer in composer |
| **App ecosystem** | Style Snap, Plushies, Angles, Recast, Transitions | ❌ |
| **Motion Control + Kling** | Proprietary camera/motion layer over Kling | ⚠️ we use Kling o3 directly, no motion layer |

### 2.4 Pricing

| Tier | Price/mo (annual) | Credits/mo |
|---|---|---|
| Starter | **$15** | 200 |
| Plus | **$39** | 1,000 |
| Ultra | **$99** | 3,000 |

Top-ups ~**$5 / 100 credits**. **Credits do not roll over**, and top-up credits **expire in 90 days**. Ultra effectively ≈ $0.033/credit; top-ups ≈ $0.05/credit — a 50% penalty for burst usage.

### 2.5 Their structural weakness — and it is large

**Higgsfield stops at the download button.** No connected accounts. No scheduling. No publishing. No analytics. No approval queue. No brand grounding. No multi-persona strategy differentiation. No cost ledger. It is a *generation studio*, and the operator still has to do all the actual work of running the accounts.

They also market to a scattered creative audience (Amphibian/Elf/Beetle character categories sit next to the influencer studio) — **they are not a business tool and are not trying to be.**

### 2.6 Social proof we cannot match on volume

25M+ claimed users, 5,000+ businesses, extensive testimonial wall, 40+ tool pages in the footer for SEO. We will not out-scale this. We must out-*specify* it.

---

## 3. Positioning map

```
                    HIGH AUTOMATION / OPERATIONS
                              │
                    ★ PersonaGen (unoccupied)
                              │
                    createpersona.ai
                    (IG scheduling only)
                              │
LOW CRAFT ────────────────────┼──────────────────── HIGH CRAFT
                              │
                              │              Higgsfield
                              │           (Soul ID, motion,
                              │            download & go)
                              │
                     MANUAL / STUDIO
```

**The wedge sentence:** *Higgsfield makes the best-looking character. createpersona schedules it to Instagram. PersonaGen is the only one that runs the account.*

---

## 4. Full parity matrix

Legend: ✅ shipped · ⚠️ partial · ❌ absent · 🏆 we are clearly ahead

### 4.1 Persona creation & identity

| Capability | Higgsfield | createpersona | PersonaGen | Notes |
|---|---|---|---|---|
| Visual persona builder | ✅ | ✅ | ✅ | [generator](../../personagen-svelte/src/routes/(portal)/generator/+page.svelte) |
| Build from reference photos | ✅ Soul ID (20+ imgs) | ✅ | ⚠️ single-image vision read | **GAP** |
| **Trained identity lock** | ✅ **Soul ID** | ⚠️ claims "100%" | ❌ multi-ref conditioning | **P0 GAP** |
| Multi-stage reference kit | ❌ | ❌ | 🏆 5 stages, restorable | |
| Backstory / personality / fears | ⚠️ | ⚠️ | 🏆 soul + archetype + psych profile + ownable angle | [engine:1910](../../personagen-svelte/src/routes/api/engine/+server.ts#L1910) |
| **Cross-persona differentiation** | ❌ | ❌ | 🏆 actively prevents two personas converging on the same look/angle | Nobody else does this |
| Voice identity (TTS) | ⚠️ | ⚠️ | 🏆 accent/nationality-matched, seeded to avoid collision | |
| Ethnicity/name coherence | ❌ | ❌ | 🏆 gender inferred from name, corrects stale values | |
| Multi-language / fluency | ❌ | ❌ | ❌ | Nobody has it — **opportunity** |
| Identity kit (bios, handles) | ❌ | ❌ | 🏆 per-platform bios to char limits + username candidates | |

### 4.2 Content generation

| Capability | Higgsfield | createpersona | PersonaGen |
|---|---|---|---|
| Text-to-image lifestyle | ✅ | ✅ | ✅ |
| Product-in-hand UGC | ✅ | ✅ | ✅ |
| Talking-head lip-sync | ⚠️ | ✅ | ✅ OmniHuman v1.5 |
| Multi-shot cinematic video | ⚠️ | ❌ | 🏆 LLM director → storyboard → parallel stills → Kling |
| **Hook-quality gate** | ❌ | ❌ | 🏆 scripts scored, below-floor killed **before** paying for video |
| Motion transfer from video | ✅ | ❌ | ❌ **GAP** |
| Recreate an Instagram shot | ⚠️ | ✅ | ❌ **GAP** |
| Model choice / cost control | ❌ | ❌ | 🏆 full catalog, tier + USD per call shown in UI |
| 4K output | ✅ | ✅ | ⚠️ **verify/expose** |

### 4.3 Distribution — our strongest ground

| Capability | Higgsfield | createpersona | PersonaGen |
|---|---|---|---|
| Platforms | **0** (download) | **1** (Instagram) | 🏆 **13** — IG, TikTok, YouTube, FB, X, Threads, LinkedIn, Bluesky, Pinterest, Reddit, Google Business, Telegram, Snapchat ([platforms.ts](../../personagen-svelte/src/lib/platforms.ts#L15)) |
| Scheduling calendar | ❌ | ✅ basic | 🏆 Day/Week/Month, per-persona rail |
| **Autonomy levels** | ❌ | ❌ | 🏆 advisor / semi / fully autonomous |
| **Autopilot** | ❌ | ⚠️ batch weekly | 🏆 tz-aware slot filling, idempotent, cost-capped, dead-letters after 3 failures |
| Approval queue | ❌ | ❌ | 🏆 [review](../../personagen-svelte/src/routes/(portal)/review/+page.svelte) |
| **Verified publish** | ❌ | ❌ | 🏆 never reports published without platform confirmation |
| Honest deletion | ❌ | ❌ | 🏆 manual-delete notice for IG/TikTok/Snapchat with permalink |
| Analytics | ❌ | ⚠️ claimed | ✅ views/likes/comments/shares per post |
| **Per-persona spend ledger** | ❌ | ❌ | 🏆 every generation costed and recorded |

### 4.4 Business grounding — uncontested

| Capability | Higgsfield | createpersona | PersonaGen |
|---|---|---|---|
| Brand brief | ❌ | ❌ | 🏆 mission, voice, traits, audience, pain points, competitors |
| **Product scraping** | ❌ | ❌ | 🏆 scrape store/product → structured products |
| UGC guidelines / presets | ❌ | ❌ | 🏆 |
| Brand theme | ❌ | ⚠️ "custom branding" | 🏆 opt-in palette |
| Multi-brand / multi-client | ❌ | ⚠️ implied | ✅ multiple briefs |

### 4.5 Commercial surface — where we are at zero

| Capability | Higgsfield | createpersona | PersonaGen |
|---|---|---|---|
| **Landing page** | ✅ | ✅ | ❌ **P0** |
| **Pricing page** | ✅ | ✅ (cards) | ❌ **P0** |
| **Billing / subscriptions** | ✅ | ✅ | ❌ "coming soon" ([settings:1069](../../personagen-svelte/src/routes/(portal)/settings/+page.svelte#L1069)) |
| **Free / no-key first run** | ✅ | ✅ | ❌ **P0** — blocked on user's own fal key |
| Gallery / proof | ✅ | ✅ | ❌ |
| Free SEO tools | ✅ 40+ | ✅ 5 | ❌ |
| Legal pages | ✅ | ✅ | ❌ |
| Team / collaboration | ⚠️ Teams plan | ⚠️ claimed | ❌ |
| Affiliate program | ✅ | ✅ | ❌ |
| Discord / community | ✅ | ✅ | ❌ |

---

## 5. Viability assessment

### 5.1 Is the market real? — Yes, and it is stratifying

Higgsfield's 25M+ user claim and the density of competitors (Creatify, Picsart Persona, The Influencer AI, createpersona) prove demand. But the market is splitting:

- **Toy tier** ($0–15) — hobbyists making a pretty face. Race to zero. Avoid.
- **Creator tier** ($29–99) — where createpersona and Higgsfield both fight. Credit-metered, low switching cost, undifferentiated.
- **Operator tier** ($200–2,000+) — brands and agencies who need *volume, consistency, approval, publishing, and an audit trail*. **Nobody is serving it. This is where PersonaGen's architecture already lives.**

### 5.2 Unit economics — our structural advantage

At our verified provider costs, one persona posting 6×/day for a month:

| Content mix | Monthly provider cost |
|---|---|
| All images | **~$15** |
| 50/50 image + standard video | **~$62** |
| Heavy cinematic | **~$200** |

Against createpersona's top tier ($79 → 233 images or 10 videos) and Higgsfield's Ultra ($99 → 3,000 credits, non-rolling), **we can serve an always-on account at 1/5 to 1/20 of credit-model retail.** A defensible offer:

> **$299/mo per brand — 5 personas, unlimited posts, all 13 platforms, you approve everything.**

That is ~$60/persona at 180 posts each — roughly **$0.33/post** all-in against a $15–200 cost base. Margin holds at every mix; it is impossible for a credit-metered competitor to match without cannibalising their own pricing.

**But:** we currently capture **none** of that because there is no billing and users bring their own keys. BYO-key is a great *enterprise* option and a terrible *default*. See P0-3.

### 5.3 Risk register

| Risk | Severity | Assessment |
|---|---|---|
| **Regulatory — synthetic content disclosure** | **HIGH** | EU AI Act transparency obligations for synthetic/deepfake content come into application **2 Aug 2026 — one week from today.** Verify current text with counsel. **This inverts the market:** createpersona sells "No Watermarks" on all three tiers as a *benefit*. We already burn an `AI GENERATED` badge into video ([video.ts:145](../../personagen-svelte/src/lib/server/video.ts#L145)). **Turn our compliance into the headline; their feature becomes their liability.** |
| **Platform ToS / account bans** | **HIGH** | Meta and TikTok both restrict undisclosed synthetic personas. Mitigation is *disclosure + brand-owned accounts*, not stealth. The README's stealth account-factory / residential-node architecture is a **strategic liability for a legitimate B2B product** — it is the wrong story for the operator tier and should be de-emphasised in all public material. |
| **IG auto-posting is harder than anyone admits** | MED-HIGH | Real IG publishing needs a Business/Creator account linked to a Facebook Page. createpersona's "auto-post to Instagram" carries the same constraint they don't mention. Our Zernio path is honest about it. Do not over-claim. |
| **Consistency gap vs Soul ID** | MED-HIGH | Directly attackable in a side-by-side. Closing it is P0. |
| **Model cost drift** | LOW | Already abstracted behind [pricing.ts](../../personagen-svelte/src/lib/pricing.ts) + `UGC_PRICING_JSON` env override. |
| **Zernio single-vendor dependency** | MED | 13 platforms all flow through one vendor whose pricing already changed once (verified 2026-07-08). Needs a second publishing path eventually. |
| **No funnel** | **CRITICAL** | Best product loses to worst product with a signup button. |

### 5.4 Viability verdict

**Viable, with a narrow and defensible position — conditional on shipping a commercial surface.**

The product risk is largely retired: the hard engineering (consistency pipeline, verified publishing, autopilot, brand grounding, cost accounting) is done and is genuinely ahead of both competitors on everything except trained identity lock. The remaining risk is **entirely go-to-market**. We are competing with a 25M-user incumbent and a well-packaged thin wrapper while having no front door.

---

## 6. Gap closure plan

### P0 — blocking launch (weeks 1–4)

1. **Landing page + pricing + gallery.** Root currently redirects to `/dashboard`. Full spec in §7.
2. **Trained identity lock (Soul ID parity).** Add a LoRA/identity-training path (fal supports FLUX LoRA training) fed by the reference kit we already generate — we produce the 20+ consistent images Soul ID asks users to supply, so **our onboarding for this is better than theirs**: they make you upload 20 photos, we *generate* them. Ship as "Locked Identity."
3. **Managed keys + billing.** Platform-provisioned provider keys with metered markup as the default; BYO-key becomes a Pro/agency toggle. Stripe subscriptions. Without this there is no business.
4. **Free first run.** N free generations on our keys, no card. Non-negotiable for conversion.

### P1 — competitive parity (weeks 5–10)

5. **Recreate-a-shot.** Paste a URL/upload → vision decompose → rebuild with our persona. *Frame it as "recreate a look/style," never "clone this creator's photo"* — sidesteps the legal exposure createpersona walked into.
6. **Expose resolution tiers.** 2K/4K as an explicit, priced control.
7. **Public gallery** driven by real outputs.
8. **Free-tool SEO pages.** UGC Script Generator, TikTok Hook Generator, IG Caption/Bio/Hashtag — we already have the LLM plumbing; these are thin route wrappers with enormous funnel value.
9. **Legal pages** — Privacy, Terms, Refund, Cookie, plus an **AI Disclosure Policy** page nobody else has.

### P2 — extend the lead (weeks 11+)

10. **Motion transfer** (Higgsfield's remaining edge).
11. **Multi-language + fluency levels** — *nobody has this*, and it is the highest-leverage untouched feature in the category. One persona → 8 markets. Pairs perfectly with our accent-matched TTS.
12. **Teams/agency workspaces** — required for the $299+ tier.
13. **Comment/DM engagement layer** — the honest version of "auto-growing."
14. **Second publishing vendor** to de-risk Zernio.

---

## 7. Landing page blueprint

**Design direction:** take createpersona's *structure* (proven, scannable) and Higgsfield's *confidence* (dark, cinematic, motion-led). Use our existing tokens — accent `#7c6aed`, cyan `#0ea5e9`, dark `#0b0713`, Playfair Display headlines over Inter body ([app.css](../../personagen-svelte/src/app.css)) — so the marketing page and the product are visibly the same object.

### Section order

1. **Hero** — dark, animated, one persona's grid of visibly-identical outputs behind the copy
2. **Logo/proof strip** — 13 platform marks (our loudest single differentiator)
3. **The 3-step** — Build the persona → Ground it in your brand → Let it run
4. **Comparison table** — "Generation studio vs. content scheduler vs. **operating system**"
5. **Feature deep-dives** — 6 blocks (§7.2)
6. **Gallery** — real outputs, same face across 12 scenes
7. **Use cases** — DTC, agencies, faceless accounts, course creators, affiliates
8. **Trust & disclosure** — the section nobody else has (§7.3)
9. **Pricing**
10. **FAQ**
11. **Footer** — product, free tools, company, legal, social

### 7.1 Hero copy

> **Eyebrow:** The AI creator platform that actually runs the account
>
> **H1:** Your AI creators. Posting on 13 platforms. While you sleep.
>
> **Sub:** Build photorealistic AI creators with a locked face and voice, ground them in your real brand and products, and let them generate, schedule, and publish — with you approving every post, and every dollar accounted for.
>
> **CTA:** Build Your First Creator — Free · *No credit card. No API keys. Live in 4 minutes.*
>
> **Sub-CTA:** See the gallery →

**Why this beats theirs:** createpersona's "Generate Content 10x Faster" is a *speed* claim in a market where everyone is fast. Higgsfield's "24/7 content machine" is a *volume* claim that ends at a download button. **"Posting on 13 platforms while you sleep" is the only claim on this page that neither of them can make.**

### 7.2 Feature blocks

| # | Heading | Copy |
|---|---|---|
| 1 | **One face. Ten thousand posts.** | A five-stage reference kit — character sheet, full body, profiles, close-up, feature grid — trains a locked identity. Not a prompt that hopes. An identity that holds. |
| 2 | **Publishes to 13 platforms. Proves it landed.** | Instagram, TikTok, YouTube, Facebook, X, Threads, LinkedIn, Bluesky, Pinterest, Reddit, Google Business, Telegram, Snapchat. And we never mark a post published until the platform confirms it. |
| 3 | **It knows your actual business.** | Point it at your store. It reads your products, prices, and photos, and builds every creator's angle around what you actually sell. |
| 4 | **Three levels of autonomy. You choose.** | Advisor suggests. Semi-autonomous drafts and you approve. Fully autonomous runs inside your guardrails. Change it per creator, any time. |
| 5 | **No two creators look or sound alike.** | Run five and they won't converge. Every new creator is checked against your whole roster — look, angle, audience, voice — and forced to be different. |
| 6 | **Every cent, on the record.** | Per-creator, per-post spend, by provider. Pick your quality tier and see the cost before you spend it. No credits. No expiry. No guessing. |

### 7.3 Trust & disclosure section — our unique asset

> **Built for brands that have to answer for what they post.**
> Every generated video carries an AI-generated marker. Every post is approved before it goes out unless you say otherwise. Every publish is verified against the platform, and when a platform makes deletion impossible we tell you plainly instead of pretending. Synthetic content disclosure rules are arriving — we shipped for them first.

Competitors sell "**No Watermarks**" as a feature on every tier. Put that contrast on the page.

### 7.4 Pricing frame

Price **per brand, not per credit** — it is our structural advantage and it reframes the comparison entirely.

| | **Studio** | **Brand** *(popular)* | **Agency** |
|---|---|---|---|
| Price | $79/mo | $299/mo | $899/mo |
| Creators | 3 | 10 | Unlimited |
| Posts | 500/mo | **Unlimited** | **Unlimited** |
| Platforms | 13 | 13 | 13 |
| Brand briefs | 1 | 3 | Unlimited |
| Autonomy | Advisor + Semi | All three | All three |
| Video | Standard | Cinematic + talking head | + priority queue |
| Extras | — | Spend ledger, verified publishing | Teams, BYO keys at cost, API, manager |

Add a comparison line: *"createpersona's top plan gives you 233 images a month. One PersonaGen creator posts 180 times a month — and you can run ten."*

### 7.5 FAQ (must answer, because they do)

Commercial rights · How consistency actually works (and why locked identity beats prompting) · Which platforms are live *today* · **Why we don't sell credits** · Whether AI creators are allowed on these platforms (honest answer + disclosure stance) · Whether you can import an existing account · What happens if a generation fails (dead-lettering) · Cancel/pause.

---

## 8. Bottom line

**Feature-for-feature we already beat createpersona.ai on everything that matters after the image is generated**, and we beat Higgsfield on everything after the download button. Our only real product deficit is **trained identity lock**, and our only real *business* deficit is that **we have no front door, no price, and no way to take money.**

Recommended sequence: **landing page + pricing → managed keys and billing → free first run → locked identity → recreate-a-shot → free SEO tools.** Nothing in P0 is research; it is all execution against a product that already works.

The claim to own, on the landing page and everywhere else:

> **Everyone else sells you a face. We run the account.**
