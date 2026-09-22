# PersonaGen — BYOK Viability Assessment

**Date:** 2026-09-21
**Question asked:** Is bring-your-own-keys worth keeping? Which keys should a customer actually bring? And why does the balance never move when a generation runs?
**Method:** read-only production queries (2026-09-21, 23:0x UTC), the key-resolution path read end to end, and the plan catalogue compared against what enforces it. Predecessor: [viability-assessment-2026-09-07.md](viability-assessment-2026-09-07.md), which graded Rails **A**, Metering **C**, Pricing **D**, Revenue path *Not yet*.

---

## 1. Verdict

| area | grade | one line |
|---|---|---|
| Metering coverage | **A−** | Every billable event since attribution shipped carries a cost and a credit value. The old **C** is closed. |
| BYOK as a product feature | **F** | Structurally margin-negative, adopted by two accounts, and the direct cause of the "billing is broken" report. Withdrawn today. |
| Balance visibility | **was F, now fixed** | The pill read the viewer's wallet; generations bill the workspace owner's. 79 of 81 attributed events billed a different account than the one that ran them. |
| Pricing model | **D** | Unchanged from 2026-09-07. Plans exist in the catalogue, nothing charges for them. |
| Revenue path | **Not yet** | 141,200 credits granted, 549 debited, 0 purchased. |

**Bottom line:** the money path works and always did. What was broken was which wallet the product showed, and a BYOK feature that erased half the evidence that billing was happening at all.

---

## 2. Why the balance looked frozen

Three independent layers. Only one is BYOK.

**a. The pill showed the wrong wallet.** `(portal)/+layout.server.ts` read `credit_accounts` for `user_id = user.id`. `credits.ts → resolveBillingAccount()` bills persona → workspace → **owner**. For any member of a workspace they do not own, those are two rows.

| wallet | balance | debit rows | last movement |
|---|---|---|---|
| the reporter's own | 2,000 cr | 0 | 2026-09-06 |
| the workspace owner's | 1,736 cr | 11 | **2026-09-21 23:51:19** |

Measured: **79 of 81** attributed generation events billed an account other than the actor. The money was correct throughout; the display pointed at a row that could never move.

**b. A stale pill.** Fixed earlier the same day (`4a9a69b`): the layout load had no invalidation dependency, so the number sat still until navigation. That fixed *refresh*, not *which wallet*.

**c. BYOK erased the rest.** On the reporting account, 49 of 87 September events ran on a customer OpenRouter key: no debit, and no ledger row at all. `credit_ledger.waived_credits` exists for exactly this case and is written on 0 of 402 rows.

---

## 3. The arithmetic against BYOK

Platform-wide, every user, since key attribution shipped:

| path | events | provider cost | credits |
|---|---|---|---|
| `byo` — openrouter | 50 | $0.94 | **305 forgone** |
| `platform` — fal | 11 | $0.88 | 264 charged |
| `platform` — openrouter | 21 | $0.25 | 84 charged |
| `platform` — firecrawl | 1 | $0.01 | 2 charged |

BYOK saved ~$0.94 of cost and forgave $3.05 of retail. **Net −$2.11.**

That ratio is not an accident of this sample. At `credit_markup: 3`, a BYOK run forgoes exactly three times what it saves — **every BYOK run destroys two thirds of its own margin, by definition of the markup.** No level of adoption improves it; adoption makes it worse.

**305 of the 655 credits ever metered — 47% — were recorded and then forgiven.**

Adoption after months of availability: **two** accounts had ever saved an OpenRouter key, one firecrawl, one zernio. One of the two OpenRouter keys belongs to the person who reported the bug.

### It was also incoherent to use

Per-event cost, all time: **fal $0.130** vs **openrouter $0.031** — media is 4.2× text, and 43% of all provider spend on 15% of events.

Nobody has ever saved a fal key. So images and video have *always* run on the platform key and *always* been charged, while text ran free on a customer key — with nothing on screen explaining the rule. A wallet that moves for pictures and not for words does not read as a discount. It reads as a broken wallet.

---

## 4. The line, which the codebase already encoded

`providers.ts` has carried a `billsToUserKey` flag that was never used as policy:

> **Bring your own key where the key is an identity. Never where the key is a cost.**

- **Zernio — identity.** It holds the customer's own social connections, is priced per connected account per month (2 free on a Google sign-in, which is the customer's own responsibility), and charges no run against it: `billsToUserKey: false`. **Keep, ungated, forever.**
- **fal, OpenRouter, Gemini, Firecrawl — cost.** `billsToUserKey: true`. **Withdrawn.**
- **Kie AI** — nothing in the product calls it, so a saved key sat unused. **Withdrawn.**
- **Higgsfield** — issues no customer key at all. Unchanged.

---

## 5. What changed today

| change | where |
|---|---|
| The sidebar pill reads the wallet that **pays**, labelled with the workspace name | `wallet-display.ts`, `(portal)/+layout.server.ts`, `(portal)/+layout.svelte` |
| Billing hero points at the workspace wallet when one pays; the empty-ledger copy no longer tells a member who has generated 87 times "Nothing yet" | `(portal)/billing/+page.svelte` |
| Customer BYOK withdrawn for all five cost providers, with a user-facing sentence in place of each key field | `providers.ts` |
| Keys saved under the old policy go **inert** — the gate sits in `getUserApiKey`, so the resolver and `keySourceFor()` can never disagree | `user-api-keys.ts` |
| Holders of an inert key keep their card and a plain notice, so they can still delete their own secret | `(portal)/settings/+page.svelte` |
| "Bring your own keys — generation at no charge" removed from the Agency plan in the catalogue, the static fallback and the landing page | `plan_catalog` (prod), `plans.ts`, `routes/+page.svelte` |

**Consequence worth stating plainly:** `key_source = 'byo'` is now unreachable for live traffic. It stays meaningful for the 50 historical rows, and the mechanism is intact — restoring `supported: true` on one provider re-opens it.

**Blast radius:** one external account with an untested OpenRouter key, plus the reporter's own.

**Not done:** a per-workspace key override for an enterprise deal, which is the honest home for this capability. The admin console has no surface for it yet.

---

## 6. What this does not fix

1. **Nothing charges money.** Four plans in the catalogue, no purchase has ever happened. This assessment moves margin from −$2.11 to whole; it does not create revenue.
2. **The free grant is still 1,000 credits** on open signup.
3. **`waived_credits` is written nowhere.** With BYOK withdrawn there is nothing left to waive, so the column is now vestigial rather than unused — worth removing or wiring if per-workspace overrides ever ship.
4. **The Free plan's `entitlements: {}`** still resolves `byok: true` by the never-brick default. It grants nothing (the catalogue is the gate, and the gated list is pinned empty by test), but it is a latent inconsistency.
5. **The reporter's Zernio key is in `error` state** — "accounts returned HTTP 400: Too big…". The one key we still want customers to bring is the one currently failing.

---

## 7. Caveats on the numbers

- `est_cost` is our price table's estimate, not a provider invoice. The **direction** of every figure here is certain; the third decimal place is not.
- 676 of 759 events carry no credits. That is **not** unmetered spend: 541 predate key attribution and 135 are `local`/`storage` events that genuinely cost $0. Post-attribution billable coverage is complete.
