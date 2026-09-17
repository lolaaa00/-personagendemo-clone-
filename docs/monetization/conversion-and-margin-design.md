# PersonaGen — Conversion & Margin Design

**Date:** 2026-09-07
**Purpose:** the monetization experience, designed from the buyer's side and priced from ours. Every decision here is grounded in what the best comparable products do (see [viability-assessment-2026-09-07.md](viability-assessment-2026-09-07.md) §5) and in the three metrics that matter: experience, conversion, margin.
**Status:** shipped unless marked *next*.

---

## 1. The three numbers this design optimises

| metric | target | how it is measured |
|---|---|---|
| Time to first value | first generated post inside 5 minutes of signup, without a card | activity log: `auth.signup` → first `post.generate.requested` with `outcome=ok` |
| Free → paid conversion | ≥ 8% of accounts that generate at least once buy a pack or plan within 14 days | `billing.purchase.completed` ÷ accounts with ≥1 debit |
| Gross margin on generation | ≥ 65% blended after bonuses and welcome credit | `Σ credits/100 − Σ est_cost` over `generation_events` where `key_source='platform'` |

---

## 2. Principles, each tied to a product that proves it

1. **Show money, not points.** Every wallet in the market shows "credits" and makes the buyer do arithmetic. We show `$20.00` in the visitor's currency, rounded to whole units. Nobody else does this; it is our most visible differentiator on the pricing page and in the app.
2. **The credit is a retail cent.** One credit = $0.01 at retail. Packs sell at par: $25 buys $25.00. The margin lives in the debit (estimated provider cost × `credit_markup`), not in a confusing pack rate. This is the Runway "$0.01 per credit" pattern with the markup moved to the place the customer never sees.
3. **Free means a taste, not a budget.** Market free allowance is 10–125 credits, one-time. Ours is $10.00 retail ($3.33 of provider cost at 3×): one persona with avatar and reference kit, plus a handful of image posts. Text cards are free forever, so a new account can post daily without ever paying, and pays only when it wants AI media.
4. **Price before you spend.** The composer's preview quotes the exact pipeline in retail. The gate refuses a run the wallet cannot cover before the first paid call, and says where to top up. No surprise debits, no negative balances from a thin wallet.
5. **Never expire.** Purchased and welcome credit stays. Higgsfield's 90-day pack expiry is the outlier everyone complains about; Runway and Leonardo's "never expires" is the pattern buyers trust. Subscription-included wallets (next) reset monthly, which is the industry norm and what makes the plan price predictable.
6. **The wall is a purchase, not a dead end.** Insufficient credit returns 402 with a link. The pill turns amber under $3.00 and red at zero. The billing page is one click from anywhere and shows what each pack buys in posts, not in credits.
7. **Bonus ladder, capped.** Larger packs carry +4%, +10%, +20%. This lifts average order value (every wallet SaaS does it) while a 3× markup still leaves the top pack at 2.5× raw cost.
8. **Per brand, not per seat.** Teams do not pay per member. Plans are sized by personas and by the included media wallet. This keeps the "we run the account" positioning that no competitor occupies.

---

## 3. The funnel, screen by screen

| step | what the visitor sees | conversion mechanism | margin guard |
|---|---|---|---|
| Landing | "Priced per brand. Not per seat." Plans with an included monthly media wallet and unlimited text posts. FAQ explains the wallet in money. | The pricing page and the app say the same thing. No "no credits" claim contradicting a wallet. | Plans include a wallet worth 50% of the plan price at retail (17% of price at raw cost). |
| Signup | No card. "Free generation credit to start." | Zero friction; card gating is the single biggest drop-off in every trial funnel. | Welcome grant 1,000 credits ($10.00 retail, $3.33 raw). Signup gate (PIN or invite) recommended until Stripe is live. |
| First session | Pill reads "Credits $10.00" in local currency. Creating a persona costs ~$0.50 retail; first image posts ~$0.25 each. | Value arrives before the wallet is empty. Text cards keep posting free. | Every persona-creation media call is metered; engine LLM calls are pennies. |
| Composer | Exact pipeline and price in retail before "Generate". | Trust. Buyers who see the price convert better than buyers who get surprised. | Gate asserts the retail estimate, not 1 credit. |
| Low balance | Pill goes amber under $3.00. | Nudge before the wall, while a run still fits. | — |
| Wall | 402 "Not enough credit. Top up at /billing to continue." | The moment of highest intent lands on the purchase page. | Fail-closed in `enforce`. |
| Billing page | Big balance in local money. "≈ 40 image posts or 8 video posts." Four packs, USD with local equivalent, "Most popular" on $25, bonus badges. Promises: never expires, price before you spend, failed runs not charged. Ledger in money. | Anchoring (the $100 pack makes $25 look small), social proof badge, concrete outcomes instead of abstract credits. | Packs at par; bonuses capped at 20%. |
| Checkout | Stripe hosted Checkout, promo codes on, receipts by email. | Trusted form, Apple/Google Pay, adaptive local pricing if enabled in Stripe. | Webhook re-validates amount vs pack; idempotent by `stripe_event_id`. |
| After purchase | Redirect to /billing, balance refreshes in seconds. | Immediate confirmation. | — |

---

## 4. Unit economics at 3× (what the customer pays vs what we pay)

| outcome | raw cost | customer price | margin |
|---|---|---|---|
| Image post (still + director) | $0.082 | $0.25 | 67% |
| Video post (b-roll clip) | $0.50 | $1.50 | 67% |
| Talking-head post | $0.81 | $2.43 | 67% |
| Cinematic multi-shot | $2.00 | $6.00 | 67% |
| Text card post | $0 | $0 | — |
| Persona (avatar + 4-stage kit) | $0.48 | $1.44 | 67% |

Compared with the market: theinfluencer.ai charges $0.13–0.19 per image and $0.75–1.90 per 5 s video; Creatify $3.50 per 30 s ad; Blotato $0.55–0.70 per Nano Banana 2 image. At 3× we are below the persona tools on every line and above the raw-wallet tools, which is exactly where a "we run the account" product should sit.

Welcome credit cost per signup: $3.33. Break-even is one $10 pack per 3 signups that generate, or one $25 pack per 7.5.

Plan economics (next, when subscriptions ship):

| plan | price | included wallet (retail) | raw cost if fully used | margin floor |
|---|---|---|---|---|
| Studio | $79 | $40 | $13.33 | 83% |
| Brand | $299 | $180 | $60 | 80% |
| Agency | $899 | $600 | $200 | 78% |

---

## 5. What shipped today (commit after `e845be7`)

- `credit_markup` platform setting with console control, migration applied, production set to **3×**.
- Welcome credit set to **1,000** ($10.00 retail).
- Credit gate quotes the retail estimate; insufficient credit is a 402 with a billing link.
- `/billing` page; pill links there and goes amber under $3.00.
- Stripe Checkout + signed webhook, dormant until `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set in the host environment. Set them in the EasyPanel UI, not through the API (the API replaces the whole env).
- Landing copy aligned with the wallet.

## 6. Next, in order

1. **Turn payments on.** Add the two Stripe env vars in EasyPanel; create the webhook endpoint for `/api/billing/webhook` with events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`. Buy the $10 pack once with a test card; confirm one `purchase` ledger row and no second row on replay.
2. **Smoke-test shadow, then enforce.** One real post from a pilot account; confirm the debit is `est_cost × 3 × 100`. Flip `credits_mode` to enforce from Controls & Health.
3. **Meter the engine** (batch generate, scrape, LLM actions, voice preview) once the concurrent session's edits to those files land.
4. **Plans.** Stripe subscription Checkout for Studio / Brand / Agency; monthly included wallet granted by the invoice-paid webhook as kind `grant` with a note; persona limits enforced from `subscriptions.plan`.
5. **Settings → Billing** section replaced by a link to `/billing`; currency preference selector there.
6. Reconciliation query updated for markup: `credits = ceil(est_cost × markup × 100)` per event.

---

## 7. Math audit (2026-09-07, second pass)

Every figure below is asserted by `src/lib/economics.spec.ts` and `src/lib/server/stripe.spec.ts`, which derive it from the pricing matrix, the server's rounding rule, the pack table and the plan table. A price change that breaks a floor fails the build.

**The unit.** `credits = ceil(raw_usd × markup × 100)` per event, float-noise safe (rounded to 6 dp before the ceil). Consequences: a debit is never below retail; the overshoot is under one credit per event; the pill's amber line (300 credits) and the packs are markup-invariant money, so changing the markup changes what a run costs, never what a credit is.

**Retail price list at 3× (per-event ceils summed, exactly as the ledger debits).**

| outcome | steps | raw | retail | margin | × raw |
|---|---|---|---|---|---|
| image post | director + grader + still | $0.104 | **$0.32** | 67.5% | 3.08 |
| video post | + b-roll clip | $0.524 | **$1.58** | 66.8% | 3.02 |
| talking-head post | + voice + OmniHuman | $0.834 | **$2.51** | 66.8% | 3.01 |
| cinematic multi-shot | + 4 stills + pro shot-set | $1.944 | **$5.84** | 66.7% | 3.00 |
| persona (avatar + 4-stage kit) | 6 stills | $0.48 | **$1.44** | 66.7% | 3.00 |
| text card post | local render | $0 | $0 | — | — |

The earlier draft of §4 quoted one LLM pass per post; the runtime records the director and the QC grader, so two are quoted here and in the billing page's "what it buys".

**Corrected 2026-09-17.** Every row above moved, because the LLM rate underneath
them was wrong by 5.8x. It read $0.002 per call from the start; the provider's
own reported cost across twelve consecutive production generations averages
$0.01164, and deriving it from the per-token rates this repo has always
documented ($1.50 in / $9.00 out per M, against the mean real call of 732 tokens
in and 1,170 out) gives $0.01163. The two agree to a hundredth of a cent, so
this was never an unknown — it was a figure nobody derived.

At the old rate an LLM call retailed for 1 credit and cost $0.0116: the text
path sold **below cost**, and a text post moved from about two cents to about
eight. Output tokens are 95% of the spend at 6x the input rate, so the lever on
this line is prompt verbosity, not the price — capping output near 400 tokens
would roughly halve it and bring the older figures back honestly.

**Welcome credit.** 1,000 credits = $10.00 retail = $3.33 raw. After a persona ($1.44) it buys 26 image posts or 5 video posts. Break-even: one $10 pack per three signups that generate.

**Packs.** Each sells at par plus bonus. Margin if fully spent at 3×: $10 → 66.7%, $25 → 65.3%, $50 → 63.3%, $100 → 60.0% (exactly 2.5× raw). Blended across an even mix: 62%. The §1 target of "≥ 65% blended" is therefore met only on the two smaller packs; the honest floor is 60% and the design accepts that on the $100 pack in exchange for order value.

**Plans (next).** Included wallet is 50–67% of price; margin floor if the wallet is fully used: Studio 83%, Brand 80%, Agency 78%.

**Gate.** The pre-run quote covers every media step; the only thing it can under-quote is the grader's LLM pass, one credit at 3×, which `allow_negative` absorbs. B-roll runs are quoted at b-roll price, not talking-head price, so a wallet that can afford the run is not refused.

**Corrections made in this pass.**

1. Webhook: `allow_promotion_codes` would have made every discounted purchase fail the amount check. Validation now uses the pre-discount subtotal for USD sessions and accepts Adaptive-Pricing currencies; the pack comes from our own metadata.
2. Webhook: refunds are cumulative in Stripe's payload. A second partial refund would have clawed back the full cumulative share again. Clawback is now target minus what earlier events took.
3. Webhook: purchases are keyed by the Checkout Session id, so `completed` and `async_payment_succeeded` for one session cannot both credit.
4. USD spend caps now fail closed while credits are enforced; they still fail open in off/shadow so analytics outages do not block generation before money is on.
5. The billing page shows the exact balance; only the sidebar pill rounds to whole units.

**Reconciliation (replaces credits plan §6 while markup ≠ 1).**

```sql
-- retail debits must equal ceil(est_cost × markup × 100) per platform-paid event
WITH m AS (SELECT (value #>> '{}')::numeric AS markup FROM platform_settings WHERE key = 'credit_markup')
SELECT e.id, e.est_cost, e.credits, ceil(e.est_cost * m.markup * 100) AS expected, l.delta
FROM generation_events e CROSS JOIN m
LEFT JOIN credit_ledger l ON l.generation_event_id = e.id AND l.kind = 'debit'
WHERE e.key_source = 'platform' AND e.created_at > now() - interval '1 day'
  AND (l.delta IS NULL OR -l.delta <> e.credits OR e.credits <> ceil(e.est_cost * m.markup * 100));
-- zero rows expected. (Events recorded before a markup change keep the old rate: filter by created_at > the change.)
```
