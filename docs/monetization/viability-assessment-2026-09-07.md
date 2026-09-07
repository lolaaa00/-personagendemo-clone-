# PersonaGen — Monetization Viability Assessment

**Date:** 2026-09-07
**Scope:** Is the credit system shipped on 2026-09-05/06 a viable way to take money, measured against production reality and against the best comparable products? What must change before the first dollar?
**Sources:** read-only production queries (2026-09-07), a line-by-line audit of every provider-spending code path, and competitor pricing fetched 2026-09-07 (URLs in §5). Companion documents: [credit-system-forensic-assessment-and-plan.md](credit-system-forensic-assessment-and-plan.md), [durable-implementation-plan.md](durable-implementation-plan.md).

---

## 1. Verdict

| area | grade | one line |
|---|---|---|
| Rails (ledger, wallet, switches, admin, activity) | **A** | Durable, idempotent, fail-closed, auditable. Nothing here needs rework. |
| Metering coverage | **C** | The media paths that carry 96% of historical cost are metered. Five paths are not, and one of them lets any user spend ~$7.90 per click with no ceiling. |
| Pricing model | **D** | The public site sells "no credits, priced per brand" at $79 / $299 / $899. The app shows a credit wallet. Neither is wired to a payment. The credit unit carries no margin. |
| Free allowance | **D** | $20.00 of raw provider cost per signup, on open signup, when the market gives $0.50–$2.00 and gates it behind a card. |
| Revenue path | **Not yet** | No Stripe. No plan entitlement. Shadow mode has debited nothing because no one has generated anything since it went live. |

**Bottom line:** the plumbing is production-grade and the product decision is missing. Two to three engineering days close the gap once the three decisions in §6 are made. The rails do not need to be touched to make those decisions; they were built to absorb them.

---

## 2. Production reality (2026-09-07)

| fact | value |
|---|---|
| accounts | 10 (8 have ever signed in; 2 active in the last 7 days; 5 in the last 30) |
| pilot cohort (five `@monarchstack.com`) | 3 logged in once around 2026-08-27; **matt and claire have never logged in**; none has generated a post |
| all historical spend | $26.26 across 643 events, **all on the admin seat**, 2026-07-05 → 2026-09-01 |
| spend by month | Jul $17.56 · Aug $8.31 · Sep $0.38 |
| generation since credits went live (2026-09-05) | **zero events, zero debits** |
| wallets | 5 × 5,000 cr (pilots) + 4 × 2,000 cr (welcome backfill) = 33,000 cr granted, 0 spent |
| personas / posts | 15 personas (0 active), 113 posts: 64 draft · 28 failed · 14 published · 4 scheduled |
| autopilot | 14 personas on advisor, 1 semi-autonomous; scheduler has logged 50 runs, all producing nothing |
| BYO keys | 2 users hold their own provider keys, 1 Zernio key |
| switches | credits_mode = shadow · activity_log = on · signup_credits = 2,000 · currency = auto · FX = ECB 2026-09-04 |

**What this means.** The reconciliation gate ("a day of clean shadow") cannot be met by waiting. It needs a deliberate smoke test: one real generation from a pilot account, then confirm the ledger row. Until that happens the debit path has only been proven by unit tests and by the 15 rollback-wrapped database assertions, not by a live request.

---

## 3. Unit economics

Raw provider cost per operation, from the pricing matrix and from observed events:

| operation | raw cost | share of historical spend |
|---|---|---|
| Kling video clip (5 s) | $0.35 – $0.42 | 49% |
| talking head (OmniHuman, ~5 s) | $0.70 | 23% |
| still (Nano Banana 2) | $0.077 – $0.08 | 24% |
| LLM call (director / grader / captions) | $0.002 | 3% |
| TTS (ElevenLabs) | $0.03 | 1% |
| text card (local ffmpeg) | $0 | — |
| cinematic shot-set (Kling O3 pro) | $1.60 | 0 so far |

Cost per post:

| mix | raw cost / post |
|---|---|
| observed historical mix (image-heavy, admin testing) | **$0.23** |
| full UGC pack with b-roll video | $0.75 – $1.25 |
| cinematic multi-shot + talking head (the "Brand" tier promise) | $2.50 – $3.50 |

Against the landing-page plans:

| plan | price | quota | raw cost if quota is used | break-even utilisation |
|---|---|---|---|---|
| Studio | $79 | 500 posts | $115 (observed mix) · $375 (video pack) | 69% · 21% |
| Brand | $299 | unlimited, 10 personas | 900 posts/mo at 3/day × 10 = $675 – $3,150 | 44% · 9% |
| Agency | $899 | unlimited | unbounded | — |

**Conclusion.** "Unlimited posts" at $299 is underwater the moment one customer runs 10 personas on video. The credit wallet is the correct fix for exactly this. The landing page and the FAQ ("credits price the wrong thing") argue against the mechanism the app now has. One of the two has to give, and it should be the copy, not the wallet.

---

## 4. Defects found in the shipped design

Ranked by money at risk. None of these is a bug in the rails; they are gaps around them.

### 4.1 The credit unit carries no margin, and money display makes that visible

1 credit = 1 US cent of **raw provider cost** (`creditsFor` = `ceil(est_cost × 100)`). Markup was pushed to "the Stripe pack price". The wallet pill now shows credits as money. Those two decisions collide:

- If a $20 pack sells 2,000 credits, the pill honestly reads "$20.00" and the margin is zero.
- If a $20 pack sells 1,000 credits (2x), the customer pays $20 and immediately sees "$10.00". That is a support ticket and a chargeback.

**Fix:** move the markup into the credit itself. Add a platform setting `credit_markup` (default 1.0 today; set 3.0 before enforce, in line with persona tools at 3–10x), and make `creditsFor(usd) = ceil(usd × markup × 100)`. Then 1 credit = 1 retail cent, packs sell at par ($20 = 2,000 credits), the pill stays honest, and the welcome grant of 2,000 credits costs $6.67 of provider spend instead of $20. The preview quote in generate-post already calls the same function so the customer sees the retail estimate before confirming. Existing balances need no migration; they simply buy less.

### 4.2 Five unmetered spend paths, one of them serious

| path | provider cost | ceiling | exposure |
|---|---|---|---|
| `/api/engine` `batch_generate` | up to 100 LLM + 100 stills per request ≈ **$7.90 per click** | none, no rate limit | any authenticated user can loop it; spend never reaches `generation_events`, so the daily/monthly USD caps on every other path cannot see it either |
| `/api/engine` `scrape_store` | ~10 Firecrawl scrapes + 2 LLM per click | none | Firecrawl credits are real money and invisible |
| 13 engine LLM actions (persona profile, identity kit, spin/extend field, read appearance from image…) | $0.002 each, vision call inlines up to 20 MB | none | highest-frequency buttons in the product |
| `/api/voices` preview | $0.03 per press | none | unlimited presses |
| API-key validation | 1 Firecrawl scrape per save | none | small |

Everything else that spends money (UGC pack, cinematic pack, refine, avatar, reference kit, autopilot) is gated before the first paid call, recorded in `finally`, and debited. Autopilot runs with the real owner's user id, so caps and credits apply there too. Zernio publishing has no per-call cost.

### 4.3 The credit gate asks for 1 credit, not the estimate

`assertCreditsAvailable(supabase, billed, 1)` in budget.ts only catches an empty or negative wallet. A user with 5 credits can start a $3.50 cinematic pack and go 345 credits negative, because `debitForEvents` runs with `allow_negative`. Fix: pass the estimate the preview branch already computes.

### 4.4 The USD caps fail open

`sumSpend` returns 0 on a ledger read error, so a database hiccup lifts every cap. The credits gate in enforce mode fails closed, which is why enforce is the safer state, not just the revenue state.

### 4.5 Open signup with a $20 welcome grant

Signup has no PIN, no card, no email-domain rule. Each new account receives 2,000 credits, which today is $20.00 of Kling video. A script that creates accounts is a direct provider bill. Industry free allowance is 10–125 credits, one-time, and usually card-gated (§5).

### 4.6 Copy contradicts product in three places

- Landing: "Priced per brand. Not per credit." / "No credits. No expiry. No guessing." / FAQ "credits price the wrong thing".
- Settings → Billing: "Subscription management is on the way".
- Sidebar pill: "Credits $20.00".

---

## 5. Benchmark: what the best relevant applications do

Fetched 2026-09-07. Higgsfield figures from its live plan config; third-party figures flagged.

| product | model | free on signup | $/credit | one image | one 5 s video | expiry | top-up | currency | runs the account? |
|---|---|---|---|---|---|---|---|---|---|
| **theinfluencer.ai** (closest comparable) | $19 / $39 / $99 / $199 per mo, 100 / 250 / 700 / 1,500 cr, 1 / 3 / 8 / 16 influencers | 10 cr, card-gated 3-day trial | $0.13 – $0.19 | 1 cr ≈ $0.15 | 5–10 cr ≈ $0.75 – $1.90 | unpublished | 24¢ flat (premium) | USD | no, "download and post yourself" |
| **Higgsfield** | Plus $49 / 1,000 cr, Ultra $129 / 3,000 cr, plus "unlimited" windows on cheap models | $3 for 40 cr, or MCP trial | $0.04 – $0.05 | ~1.7 cr ≈ $0.08 | 5 cr ≈ $0.25 | monthly reset; packs 90 days | 500 cr $26 … 4,000 cr $190 | USD | no |
| **Creatify** (UGC ads) | $39 / 100 cr, $99 / 300 cr | 5–10 cr/mo | $0.33 – $0.39 | 1 cr | 30 s ad = 10 cr ≈ $3.50 | 2 months rolling | not published | USD | no |
| **Arcads** (UGC ads, third-party figures) | $110 / 10 videos, $220 / 20 | none | ≈ $11 per video | — | — | unverified | none | USD | no |
| **MakeUGC** | $59 / 500, $79 / 1,000, $149 / 2,000 cr | $1 trial | $0.075 – $0.12 | — | — | end of month | not published | USD | no |
| **Captions** | $24.99 / 500 … $279.99 / 5,600 cr | none | $0.05 flat | 1–3 cr | Veo 3 4 s = 64 cr ≈ $3.20 | rolls over to 3x | none, upgrade only | USD | no |
| **Blotato** (scheduler + AI) | $29 / 1,250 cr / 20 accounts, $97 / 5,000, $499 / 28,000 | 60 cr, 7-day trial | $0.018 – $0.023 | nano-banana-2 30 cr ≈ $0.55 – $0.70 | Veo 50 cr/s | rolls over (may change) | 1,000 cr for $6 (cheaper than plan) | USD | automation, not management |
| **Postiz** (scheduler) | $29 / $39 / $49 / $99 by channel count; AI as hard quota (3–60 videos/mo) | 7-day trial | — | quota | quota | monthly | none | USD | no |
| **Runway** (reference wallet) | $15 / 625, $35 / 2,250, $95 / 9,500 cr, per seat | 125 cr one-time | $0.010 – $0.024 | 8 cr | Gen-4.5 60 cr ≈ $0.60 – $1.45 | monthly reset (Max rolls 1 mo) | $0.01 flat, min $10, never expires | USD | no |
| **Leonardo** (reference wallet) | $12 / 8,500 … $60 / 60,000 tokens | 150 tokens/day | — | GPU-load based | — | bank to 3x monthly | never expires | USD ex-tax | no |
| **PersonaGen today** | wallet only; landing says $79 / $299 / $899 per brand | **2,000 cr = $20 raw**, open signup | $0.01 raw, no markup | 8 cr | 35–42 cr | never | none | **visitor's currency** | **yes** |

Raw reference: fal Nano Banana 2 $0.08 per image; fal Kling 3.0 pro from $0.112/s; Runway API $0.12/s.

**Industry pattern, in ten lines**

1. Free allowance is tiny, one-time, and usually behind a card: one or two images' worth, never a video budget.
2. Persona and UGC tools charge **3–10x** raw provider cost per image. General wallets charge 1.2–2.5x. The persona layer is what gets priced, not the model.
3. Subscription credits reset monthly with no rollover in most products. Purchased top-ups almost never expire.
4. Top-ups are priced at or below the plan rate to remove the "ran out" wall.
5. Everyone presents points, not money, and anchors the point to a human unit ("1 credit = 1 photo").
6. Nobody shows local currency. USD only, tax at checkout.
7. Persona tools price per account with an influencer quota. Schedulers price per channel. Wallets price per seat. **Nobody prices per brand.**
8. "Unlimited" windows on commodity image models are the 2026 upsell; credits are reserved for premium video.
9. **Nobody claims to run the account.** theinfluencer.ai explicitly says download and post yourself. Blotato is the only one combining generation with auto-posting, sold as automation.
10. Competitor pages churn monthly (Higgsfield's ladder moved between August blogs and its live config). Re-verify before quoting.

**Where PersonaGen is already ahead:** money-in-local-currency display, per-brand positioning, and "we run the account" are all unoccupied. The wallet, ledger, admin grants, and activity log are at parity with or better than the tools above.

---

## 6. Three decisions that unblock revenue

These are product decisions, not engineering ones. Recommended answers are first.

**Decision 1 — pricing shape.** *Recommended:* subscription per brand with an included monthly wallet, plus top-up packs at par. Studio $79 includes $40 of wallet; Brand $299 includes $180; Agency $899 includes $600, BYO keys at cost. This keeps the per-brand wedge the landing page already argues for, kills "unlimited", and matches the Higgsfield / Runway pattern buyers already understand. Alternative: pure wallet, no subscription. Simpler, but it abandons the per-brand positioning and the recurring revenue.

**Decision 2 — markup.** *Recommended:* 3.0x on platform-paid generation (persona-tool median), BYO keys free. At 3x a video post costs the customer ~$1.20–$1.50 and an image post ~$0.25, both under theinfluencer.ai. Set it in `platform_settings.credit_markup`, changeable from Controls & Health without a deploy.

**Decision 3 — free allowance and signup.** *Recommended:* welcome grant 500 credits ($5.00 retail = $1.67 raw at 3x), signup closed by PIN or invite until Stripe is live, card required for any grant above that. Pilots keep their $50.00.

---

## 7. Path to the first dollar

Ordered so each step is safe to deploy alone. Effort is engineering time, assuming the concurrent session's edits to engine, ai-client and settings have landed.

| # | step | effort | closes |
|---|---|---|---|
| 1 | Add `credit_markup` setting; `creditsFor` and the preview quote use it; gate asserts the real estimate instead of 1 credit | 2 h | §4.1, §4.3 |
| 2 | Meter the engine: wrap `batch_generate`, `scrape_store`, the 13 LLM actions and `/api/voices` in the same gate-record-debit pattern the avatar path uses (`runBudgetedAssetJob`); cap `batch_generate` count at 12 and rate-limit it | 4 h | §4.2 |
| 3 | Set signup_credits 500 from the console; set ADMIN_PIN or invite-only signup | 15 min | §4.5 |
| 4 | Smoke test: one real post from a pilot account in shadow; confirm the ledger row and reconciliation query return one matching pair | 30 min | §2 |
| 5 | Flip credits_mode to enforce from Controls & Health | 1 min | revenue protection live |
| 6 | Rewrite landing pricing section and FAQ, replace the Settings → Billing placeholder with balance, ledger, and a "Buy credits" button | 3 h | §4.6 |
| 7 | Stripe: Checkout for packs ($10 / $25 / $50 / $100 at par) and for the three plans; webhook → `credit_apply` with `stripe_event_id` idempotency (already indexed); plan entitlement row on `subscriptions` | 1 day | C11 |
| 8 | Make the USD caps fail closed when credits are in enforce; schedule reconciliation and roll-ups | 2 h | §4.4, C12 |

Total: about two and a half engineering days after the three decisions. Steps 1–5 can ship today.

---

## 8. What was not changed by this assessment

Nothing. This document is read-only analysis. The production queries were SELECTs. No switch, wallet, code, or copy was modified.
