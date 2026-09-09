# The Promise Audit

A checklist, not a script. It exists because it outperformed severity ranking four times in one day, across two sessions, on findings a general sweep did not surface first.

## The method

**Take each claim the product makes in writing to a customer, and find the line of code that must enforce it.**

Classify each claim:

| | Meaning |
|---|---|
| **Enforced** | Name the line. Record it — a claim that holds is as useful to know as one that does not, because the next person to touch that line needs to know a promise depends on it. |
| **Unenforced** | The claim is false today. Either change the code or change the sentence; both are legitimate, and which one is a product decision, not an engineering one. |
| **Partial** | True on one path and false on another. The most dangerous class, because whoever wrote it tested the path where it was true. |
| **Unverifiable** | No code could decide it. Either make it decidable or stop saying it. |

## Where the claims live

Sweep all of these. The list of things a product says about itself is finite, which is what gives this method a stopping point that a general audit does not have.

- Landing page, pricing and plans copy, FAQ blocks
- The billing page, including any "what you get" or promises block
- Onboarding, empty states and first-run hints
- Tooltips, helper text and field descriptions in settings
- **Confirmation dialog wording** — it states a consequence, which is a promise about what the next click does
- The in-app guides page
- `docs/API.md` and the developer page
- Anything with a number in it: counts, limits, percentages, durations, prices

## Claims that deserve suspicion first

Ordered by how badly a customer feels misled when the claim turns out to be false.

1. **Approval and review** — anything saying content is seen before it is published
2. **Deletion and retention** — anything saying data is removed, or kept for a stated period
3. **Price and billing** — what is free, what is charged, what happens on failure, what a plan includes
4. **Limits and caps** — what happens when one is reached, and who it applies to
5. **Security** — encryption, access, who can see what
6. **Consistency and quality guarantees** — anything promising sameness across outputs
7. **Ownership, cancellation, refunds**

## What it has found

Four findings, none of which a severity sweep surfaced first:

| Promise | Reality | Fix |
|---|---|---|
| "You approve before it posts" | The generation route never read the persona's autonomy setting, so a connected persona published live on Generate, before the user saw it | `b720a62` |
| Deletion means the data is gone | Nothing deleted stored media, and the bucket is public with stable paths — so a deleted user's images stayed publicly downloadable | `5160d38`, proven live by `26d6283` |
| "Text posts are free" (four surfaces) | The card renders for $0, but the post still runs the Director and the grader — about 2 credits. The FAQ used it to argue six posts a day cost nothing; that is about $0.12/day | `7737d82` |
| "Failed runs are not charged" | Cost recording flushes in a `finally`, so a run that dies after buying images is charged for them — correct behaviour, but the sentence had stopped matching it | `7737d82` |

## Why it is a manual gate

A regex only catches phrasings already known, and the judgement is the point: deciding whether a sentence is false, imprecise, or fine is not mechanisable.

What **is** mechanisable is the second half. Once a claim is classified as enforced, bind it to its line in a spec so it cannot quietly stop being true. `money-claims.spec.ts` does this for the pricing claims: no surface may say text posts are free while the language-model price is above zero, and the claims that do hold — "never expires", "at par" — are asserted against the code that makes them hold.

Run the sweep when customer-facing copy changes, when a promise-bearing code path is rewritten, and before any pricing or plan launch.

## A note on where false claims come from

Three of the four were written by the same people who wrote the code, within days or hours of each other, and were true of the path the author had in mind. "Text posts are free" is true of the card renderer. "Failed runs are not charged" was true before cost recording moved into a `finally`. The failure is not carelessness; it is that a sentence and the line that makes it true have no link between them, so they drift independently. That is why the enforced claims get bound in a spec rather than merely noted.
