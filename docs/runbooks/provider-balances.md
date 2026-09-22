# Runbook — provider balances and platform keys

**Audience:** whoever operates the deployment.
**Where to look:** Admin Console → Platform Controls. Both balances and the key
inventory are on that page; neither is exposed on `/api/health`, which publishes
only the coarse word `ok` / `low` / `unknown`.

---

## Why this matters more than it used to

Until 2026-09-21 a customer could bring their own OpenRouter or fal key, and
their generations ran on it. That is withdrawn — see
[byok-viability-assessment-2026-09-21.md](../monetization/byok-viability-assessment-2026-09-21.md).

**Every generation for every customer now runs on the platform's keys.** A key
that is missing, revoked or unfunded is an outage for everyone, with no
per-user fallback absorbing any of it.

---

## The two accounts

| | OpenRouter | fal |
|---|---|---|
| what it pays for | captions, reasoning, routing, some images | images, video, talking heads |
| cost per event (measured, all time) | $0.031 | **$0.130** |
| share of all spend ever | 57% (on 85% of events) | 43% (on 15% of events) |
| how it fails | degrades — calls start erroring | **locks the account**, all requests rejected |
| warns below | $24.64 (70 worst-case posts) | $46.69 (70 worst-case posts) |
| top up at | `openrouter.ai/settings/credits` | `fal.ai/dashboard/billing` |

fal is the expensive one and the one that fails hardest. It was also the
unwatched one until 2026-09-22.

---

## Turning on the fal balance watch

The console will say **"fal balance not watched"** until you do this once.

fal issues two key scopes. **API** can call models; **ADMIN** can additionally
read `/v1/account/billing`. The production `FAL_API_KEY` is API-scoped — it
answers the billing endpoint with `403 authorization_error`, measured
2026-09-22. So this needs a second key, which is the right shape anyway: the
balance reader must not hold a key that can spend.

1. Go to `fal.ai/dashboard/keys`, confirm the correct account is selected in the
   top-left, and create a key with scope **ADMIN**.
2. Set it in the deployment environment as **`FAL_ADMIN_API_KEY`**.
   Do **not** reuse it as `FAL_API_KEY`, and do not point `FAL_ADMIN_API_KEY` at
   the existing generation key — it will read `unknown` forever.
3. Redeploy. The Admin Console should show a figure within five minutes (the
   probe is cached for that long; it refreshes on console load).

If it still says `unknown`, the note on screen names the cause — a 403 means the
key is API-scoped, not that fal is down.

### Related: the MCP key

The fal MCP server in this workspace authenticates with the same key as
production `FAL_API_KEY`, so MCP `run_model` / `submit_job` calls spend the real
wallet with no ledger entry and no metering. Minting the separate admin key is a
good moment to mint a separate MCP key too.

---

## Platform provider keys panel

Read-only by design. It shows, per provider: the environment variable, whether
it is set (a boolean derived from presence — the panel never reads, returns or
masks a key value), the last successful platform-keyed call, and the 30-day
event count.

It is deliberately **not** a key editor. These live in the deployment
environment, where changing one is a deliberate and audited act; a web form that
rewrites the platform's spending credentials is a far larger blast radius than
the problem it would solve.

| variable | provider | absence means |
|---|---|---|
| `OPENROUTER_API_KEY` | OpenRouter | captions and text generation fail |
| `FAL_API_KEY` | fal | all images and video fail |
| `GEMINI_API_KEY` | Gemini | LLM fallback unavailable |
| `FIRECRAWL_API_KEY` | Firecrawl | brand-brief research fails |
| `ZERNIO_API_KEY` | Zernio | publishing falls back to each customer's own Zernio key; anyone without one cannot publish |
| `FAL_ADMIN_API_KEY` | fal (billing read only) | the fal balance is unwatched |

"Configured, but no successful call in 30 days" is expected for a provider
nothing currently uses. It is worth checking only when you believe the provider
*is* in use — then it usually means the key was revoked upstream.

---

## Known gap

The unauthenticated `/api/health` word folds both accounts, but an
**unconfigured** fal is excluded from it rather than counted as `unknown`.
Degrading public health for an account nobody has opted into watching would
train an operator to ignore the signal. The Admin Console shows `unconfigured`
in its own right. Once `FAL_ADMIN_API_KEY` is set, fal counts toward the health
word like OpenRouter does.
