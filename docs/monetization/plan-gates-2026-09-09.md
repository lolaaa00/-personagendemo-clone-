# Plan feature gates — what the catalog sells and what enforces it

**2026-09-09.** Written after wiring the gates. The audit that prompted it used
the promise-audit method: take each written claim, find the line that must make
it true, and if there is no such line, that is the finding.

## What the audit found

The catalog sells twelve things across four plans. **One** had code behind it.

| Feature line | Plans | Enforced before | Enforced now |
|---|---|---|---|
| N personas / Unlimited personas | all | `personaLimitExceeded` in `/api/agents` | unchanged |
| $X / month of media included | paid | `invoice.paid` grant + clawback | unchanged |
| N brand briefs / Unlimited | paid | **nothing** — `brand_brief_limit` was read by no code | `/api/engine` `save_brief`, on create only |
| Advisor + Semi-autonomous (Studio) | Studio | **nothing** | `/api/agents/config`, on raise only |
| All three autonomy levels (Brand) | Brand | **nothing** | same gate, higher ceiling |
| Cinematic multi-shot + talking head | Brand+ | **nothing** | `/api/agent/[id]/generate-post` |
| Priority generation queue | Agency | **nothing** — no ordering concept existed | autopilot run ordered by plan |
| Teams + shared workspaces | Agency | **nothing** | `/api/workspaces` POST |
| Bring your own keys — at no charge | Agency | the *no charge* half was already true | `/api/settings/api-keys`, generation providers only |
| API access | Agency | **nothing** | `/api/developer/keys` POST |
| Spend ledger + verified publishing | Brand+ | universal | **still universal — copy overstates it** |
| Approval queue | Brand | universal | **still universal — copy overstates it** |

## Why nothing broke when this shipped

Two rules in `src/lib/server/entitlements.ts`:

1. **An absent key means no restriction.** An unmigrated database, an unfilled
   plan row, or a catalog read that throws all resolve to *allowed*. A gate
   never fails closed.
2. **A paid plan is never resolved below free.** Free is seeded permissive
   because all nine live accounts are on it. So every gate is currently inert,
   and a paying Studio customer can never be handed less than someone paying
   nothing — which a naive per-plan lookup would have done the moment plans
   opened.

## The launch-day edit

**Two edits, not one.** The `entitlements` JSONB arms six axes; the two LIMIT
axes are separate columns and are not touched by it. Measured against
production on 2026-09-09, with 11 accounts and 18 personas:

| Axis | Armed by | Accounts affected today |
|---|---|---|
| cinematic, api, teams, priority | the JSONB edit | **none** — zero cinematic generations ever, `api_keys` is empty, one workspace exists and its 6 members are untouched, free already ranks 0 for priority |
| max_autonomy | the JSONB edit | **one persona**, and only by preventing a future re-raise. 15 of 16 configs are already `advisor`; the gate refuses a RAISE only, so nothing running stops and unrelated saves still save |
| byok | the JSONB edit | **two accounts** hold an OpenRouter key. They keep and can still test it; only re-saving or rotating is refused |
| persona_limit, brand_brief_limit | **a separate UPDATE of those columns** | not armed by the edit below. Free is `NULL` = unlimited |

Two consequences worth knowing before you decide:

- While `free.brand_brief_limit` is NULL, `atLeast` propagates that null upward,
  so the brief gate is inert for **Studio and Brand as well** — their advertised
  "1 brand brief" and "3 brand briefs" cannot bind until free carries a number.
- The persona limit has a second reader, `personaLimitExceeded` in `plans.ts`,
  which goes straight to the catalog row and does not pass through `atLeast`.
  That is the one that actually guards persona creation today.

**No client code reads entitlements.** Every refusal is server-side, so a
tightened plan produces a 403 on a button that still looks enabled — the
autonomy select still offers all three levels, Settings still shows the
generation-key fields, and the composer still offers Cinematic. Fix that before
arming anything a user can see, or the gates will read as bugs.

The JSONB edit — this is what arms the six feature axes:

```sql
UPDATE public.plan_catalog SET entitlements =
  '{"max_autonomy":"advisor","cinematic":false,"teams":false,
    "api":false,"byok":false,"priority":false}'::jsonb
WHERE plan = 'free';
```

And, only if Free is meant to cap volume as well, the second edit:

```sql
UPDATE public.plan_catalog
   SET persona_limit = <n>, brand_brief_limit = <n>
 WHERE plan = 'free';
```

That second one is the edit with real blast radius: the three active accounts
hold 11, 4 and 3 personas today. Both limit gates are create-only, so nothing
already made breaks — but new creation stops for the accounts using the product
most. Decide what Free should include before running either; that is a product
decision, not a technical one.

## Two copy decisions left open

Neither is a gate; both are wording:

- **"Spend ledger + verified publishing"** is listed under Brand. Every plan
  sees the ledger and the publish receipts.
- **"Approval queue"** is listed under Brand. Review-and-approve is how every
  persona below fully-autonomous works, on every plan.

Either move them to the shared list, or make them real. They are recorded as
`universal` in `entitlements.spec.ts` so the ratchet passes deliberately rather
than by omission.

## What BYOK already did right

`keySourceFor` marks a generation event `'byo'` when the user holds a key for
that provider, and `charge()` skips every row whose `key_source` is not
`platform`. So a user on their own key is not billed for spend we never bore —
the Agency line "generation at no charge" was already true for everyone. There
is also no fallback to the platform key when a user key fails, so we cannot
silently absorb their failures either. Two accounts hold OpenRouter keys;
neither was overcharged.

BYOK gating therefore covers only the **generation** providers (OpenRouter,
Gemini, fal, kie). Zernio is how every plan publishes and Firecrawl is how
briefs are researched; gating those would break what Free is promised.

## The ratchet

`entitlements.spec.ts` walks every feature string in the catalog and demands
each one either name a gate that still exists in the file that holds it, or be
recorded as universal with a reason. `plan-gates.spec.ts` calls each handler
and asserts the refusal, and asserts what each gate must *never* catch.

Adding a feature line to the catalog with nothing behind it fails the suite.
Deleting a gate fails it too. Both proven by mutation, not assumed.
