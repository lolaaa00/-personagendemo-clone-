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
