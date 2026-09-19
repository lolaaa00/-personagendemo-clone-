# muapi White-Label AI Studio + Open-Generative-AI — Viability & Alignment Assessment

**Date:** 2026-09-19
**Subjects:** `https://muapi.ai/white-label-ai-studio` · `github.com/anil-matcha/open-generative-ai`
**Question asked:** could PersonaGen be implemented or set up "in this way"?
**Measured against:** PersonaGen on `ux/portal-overhaul`, file:line reads on 2026-09-19.
**Method:** the repository's README, LICENSE, `package.json`, `docker-compose.yml`, submodule list, API route sources and `packages/studio` manifest fetched from GitHub; muapi's white-label page, home, pricing, terms, refund policy, white-label docs and per-model playground pages fetched live; muapi's `openapi.json` (2.2 MB, 1,107 paths) downloaded and parsed. Every number below is quoted from those sources or read from our code. Nothing is from memory.

---

## 0. Executive verdict

**The two links are one company, and "this way" is three different proposals that need three different answers.**

`Open-Generative-AI` is an MIT-licensed front end whose homepage is a muapi.ai UTM link and whose every cloud request is a passthrough to `https://api.muapi.ai` carrying the *end user's* muapi key from `localStorage` (`app/api/app/[[...path]]/route.js:3` — `const MUAPI_BASE = 'https://api.muapi.ai'`; no server-side key exists). The "white-label AI studio" is muapi hosting that same studio under your logo, on their infrastructure, at `muapi.ai/studio/your-slug`. Both are operated by Vadoo Internet Services Private Limited, Bangalore. The repo is the funnel; the white-label is the product; the API is the business.

| Reading of "set up our app this way" | Verdict | One-line reason |
|---|---|---|
| **A. Become a white-label operator** — pay $49–$499/mo, put our logo on their hosted studio, set a markup over their rates, charge through our Stripe | **No.** | It is a generic prompt→media studio. It has none of what PersonaGen *is* — personas, brand briefs, scheduled publishing to 13 platforms, an approval queue, a spend ledger, workspaces and seats. It would replace our product with theirs under our name, and we already own every rail it sells (wallet, markup, Stripe, entitlements). |
| **B. Use muapi as a model provider** behind our registry, the way fal and OpenRouter sit there today | **Possible later, not now.** | Technically a fit — the API is fal-shaped and our adapter pattern already exists. Cheaper on some rows, dearer on Kling. Blocked by their terms: *"Use our APIs to build competing services"*, unscoped keys with full account access, a liability cap of $100, no refund for a failed generation, Bangalore jurisdiction. A failover candidate at best, and only with a written answer on the competing-services clause. |
| **C. Fork or embed the MIT studio components** | **No.** | MIT permits it, but `packages/studio` is hardwired to muapi's URL scheme and auth header, is React 19 inside our Svelte app, and its studios run 45–170 KB of JSX each. We would be building a muapi-compatible shim over our own engine to host a UI that is *less* aligned with our product than the one we have. |

**What is genuinely worth taking** — none of it requires them:

1. **Sandbox mode** — a full signup-to-generation flow that returns sample results and spends nothing, "yours or your end users'". We have `$0` typographic cards and live demos in `/guides`, but no no-spend path through a *media* generation. That is the cheapest conversion tool on their page and the one gap it exposes.
2. **Free credits on signup as an operator knob** — echoes the Fannabe finding: our free tier is a one-time welcome grant ([plans.ts:36](../../personagen-svelte/src/lib/server/plans.ts#L36), `included_credits: 0`), theirs is configurable per instance.
3. **Studio toggles per instance** — we already have this as plan entitlements ([plans.ts:37–39](../../personagen-svelte/src/lib/server/plans.ts#L37)); nothing to build.
4. **A public per-model rate card with competitor comparison** — muapi's `/pricing` lists 622 models against fal/Replicate/OpenAI. We quote per run before spend, which is stronger for a buyer; a public card is a marketing surface we could add from `pricing.ts` for free.

---

## 1. What the two things actually are

### 1.1 The repository — measured

| Fact | Value |
|---|---|
| Licence | **MIT**, plain 21-line text, "Copyright (c) 2026 Open Generative AI Contributors" |
| Stars / forks / issues | 28,829 / 5,226 / 36 open |
| Created / last push | 2023-05-09 / 2026-09-17 |
| Stack | Next.js 15, React 19, Electron; JavaScript |
| Runtime deps | 9 — `next`, `react`, `react-dom`, `axios`, `react-hot-toast`, `xtend`, plus three local workspace packages |
| Submodules | `Vibe-Workflow` (SamurAIGPT), `Open-Poe-AI`, `Open-AI-Design-Agent` (both Anil-matcha) |
| Docker | `docker-compose.yml` is 8 lines: build, port `3001:3000`, `NODE_ENV=production`. No env, no volumes, no database. |
| API routes | 8, all passthroughs: `app/api/app/[[...path]]`, `app/api/api/v1/[[...path]]`, `agents`, `workflow`, `creative-agent`, `upload-binary`, `get_upload_url` |
| Where requests go | `api.muapi.ai`, and nowhere else. The README says so: *"API Key Management — Secure API key storage in browser localStorage (never sent to any server except Muapi)."* |
| Server-side secrets | **None.** `grep process.env` over both proxies returns nothing. The key is the end user's, per browser. |
| Local inference | Desktop app only: bundled `sd.cpp` (SD 1.5 / SDXL / Z-Image) and a bring-your-own Wan2GP Gradio server. Not part of the hosted web version. |
| `packages/studio` | 20 exports (`ImageStudio`, `VideoStudio`, `AudioStudio`, `LipSyncStudio`, `CinemaStudio`, `MarketingStudio`, `WorkflowStudio`, `AgentStudio`, `AiInfluencerStudio`, …), peer-deps React only, description *"Open Generative AI studio components for Muapi"*. Component sizes: `VideoStudio.jsx` 144 KB, `LayersStudio.jsx` 173 KB, `ImageStudio.jsx` 79 KB. |
| Studio portability | `pollForGenerationResult({ baseUrl, requestId, apiKey })` builds `${baseUrl}/api/v1/predictions/${requestId}/result` with header `x-api-key`. `baseUrl` is a parameter; the **path scheme and auth are muapi's**. Pointing it elsewhere means serving muapi's API. |
| `models_dump.json` | 70 KB, one array of model schemas (id, inputs, enums). **Zero** price fields. |

The README's own pitch, verbatim: *"Turn This Into Your Own Product — White Label & Resell … Plans start at $49/mo."* And: *"No content filters, no prompt rejections, no guardrails."* Topics include `uncensored`.

### 1.2 The API — measured from `openapi.json`

| Fact | Value |
|---|---|
| Spec | OpenAPI 3.1.0, "Muapi API" 1.0.0, server `https://api.muapi.ai` |
| Paths | **1,107**; 857 under `/api/v1` (generation endpoints); 24 under `/whitelabel/*`; the rest app/admin/teams/social |
| Auth | `x-api-key` header (also `Authorization: Bearer`). Spec text: *"Unscoped — an API key has full access to its account, same as the account holder."* A separate OAuth2 client-credentials flow exists with scopes `generate:write`, `generate:read`, `files:write`, `account:read`. |
| Pattern | POST `/api/v1/<model>` → `request_id` → poll `/api/v1/predictions/{id}/result`; `webhook` parameter on every generation op (2,647 mentions). `team_id` on 933 of 1,107 ops. |
| Cost on the contract | **None per endpoint.** Cost lives behind `/app/calculate_dynamic_cost`, `/app/credit_transactions`, `/app/usage_by_keys`. A quote must be fetched, not read from the schema. |
| Our exact models present | `nano-banana-2`, `nano-banana-2-edit`, `kling-v3.0-standard-image-to-video`, `elevenlabs-tts-turbo-2-5`, `omnihuman-1-5`, `openai-whisper`, `topaz-upscale-image` |
| White-label endpoints | `/whitelabel/owner/instance`, `/stripe-credentials`, `/smtp-credentials`, `/users`, `/users/{id}/credit-adjustments`, `/users/{id}/ban`, `/subscription-tiers`, `/custom-domain/recheck`; end-user `/whitelabel/auth/*`, `/balance`, `/payments/checkout`, `/payments/subscribe` |

This is the same shape as fal's queue API, which is why option B is technically plausible: our [`adapterFromProbe`](../../personagen-svelte/src/lib/server/model-registry.ts#L1019) and `registryDefault` were built for exactly this request→poll pattern.

### 1.3 The white-label product — measured from its page and docs

Hero, verbatim: *"Pick a name, get a hosted app instantly, brand it, connect your own Stripe account, and start charging your own users — all powered by Muapi's 250+ generation models. No infrastructure, no code."*

| What the operator gets | Source text |
|---|---|
| A hosted app, **not code** | *"A hosted product, not a codebase to maintain."* FAQ: *"No. Muapi hosts the app, runs the models, and manages uptime."* |
| URL | `muapi.ai/studio/your-slug`; optional custom domain via TXT `_muapi-verify.<domain>` + CNAME to `muapi.ai`, auto-SSL |
| Branding | logo, favicon, app name, primary colour |
| Studios | 13, toggleable: Image, Video, Audio, AI Clipping, Vibe Motion, Lip Sync, Cinema, Marketing, Workflows, Agents, Design Agent, Apps, MCP & CLI |
| End users | sign-up, login, credit balance, usage history; operator can adjust credits and ban/unban |
| Pricing control | *"set a credit markup over MuAPI's cost and how many free credits new signups get"*; markup is a multiplier, e.g. `2.0` |
| Payments | *"Checkout runs through your own Stripe account … Muapi is never in the payment path and doesn't use Stripe Connect."* Operator pastes Stripe secret + webhook secret into their dashboard. |
| Sandbox | full flow with sample results, *"no credits spent, yours or your end users'"* |
| Limits | **one white-label instance per account**; no custom code; no end-user API; **no data export documented**; no moderation tooling beyond ban/unban and studio toggles |

**Platform fee, verbatim:** Starter **$49/mo** ("Up to 100 end users", "Image + Video studios"); Growth **$149/mo** ("Up to 1,000 end users", "All 13 studios"); Scale **$499/mo** ("Unlimited end users"). *"Your platform plan covers running the app. You separately pay Muapi's normal API rates from your own wallet for generations."* No setup fee, no revenue share, no annual price.

---

## 2. Side by side: PersonaGen vs the white-label studio

| Capability | muapi White-Label | PersonaGen | Who has it |
|---|---|---|---|
| Prompt → image/video/audio across hundreds of models | ✅ 250–622 models, 13 studios | ⚠️ Persona-bound generation; 16 formats ([formats.ts](../../personagen-svelte/src/lib/formats.ts)); fal + OpenRouter + Gemini routes; no generic free-prompt studio for end users | **Them, by breadth** |
| Consistent AI persona | ⚠️ "AI Influencer Studio" (one `46 KB` component) | ✅ Five-stage reference kit, hero portrait, `TraitPicker`, persona preview, identity kit | **Us, by depth** |
| Brand grounding (reads the client's store, products, prices) | ❌ | ✅ Brand briefs, Firecrawl scrape, product-aware Director | **Us** |
| Publishing to platforms, verified | ❌ | ✅ 13 platforms via Zernio, published only on platform confirmation | **Us** |
| Approval queue / autonomy levels / scheduling | ❌ | ✅ Advisor / semi / fully autonomous; calendar; review queue | **Us** |
| Multi-tenant workspaces, seats, roles | ❌ one instance per account; flat end-user list | ✅ owner/admin/manager/creator/viewer ([workspaces.ts:20](../../personagen-svelte/src/lib/server/workspaces.ts#L20)), invites, per-seat caps | **Us** |
| Wallet, markup, Stripe, entitlements | ✅ operator markup multiplier, own Stripe keys, free signup credits | ✅ `credit_markup=3`, wallet at par, `/billing`, plan entitlements ([plans.ts](../../personagen-svelte/src/lib/server/plans.ts)); Stripe wired but dormant pending keys | **Parity** |
| Per-run quote before spend, ledger truth | ⚠️ cost via `/app/calculate_dynamic_cost`; no per-endpoint price on the contract | ✅ Quote = upper bound on bill; quote/gate/charge asserted by spec | **Us** |
| BYOK | ❌ end user's muapi key only | ✅ per-provider stored secrets; wallet never debited for BYO runs | **Us** |
| Public API for tenants | ❌ not documented for end users | ✅ scoped keys, `/developer` docs and console | **Us** |
| Sandbox / no-spend full flow | ✅ | ❌ (`$0` text cards and `/guides` demos only) | **Them** |
| Recurring free credits for signups | ✅ operator knob | ❌ one-time welcome grant | **Them** |
| Local / offline inference | ✅ desktop app only | ❌ | Them, irrelevant to a hosted SaaS |
| Content policy | ToS bans nudity; site markets "Spicy" models; repo says "no content filters" | Brand-safe by settled policy (no NSFW, no swaps onto real people) | **Us, for our buyer** |

**Read the table as a shape, not a score.** They are a studio with billing bolted on. We are an operations product with a studio inside it. The overlap is the studio; everything else on our side has no counterpart on theirs.

---

## 3. The three options, costed

### 3.1 Option A — become a white-label operator

**What it would mean.** Our customers log into `studio.ourbrand.com`, which is muapi's app with our logo. Their generations, credit balances and usage history live in muapi's database under our instance. We pay $149–$499/mo plus muapi's rates from our wallet; they pay us through our Stripe at our markup.

**Why no.**

- **It is not our product.** Nothing on that page runs an account, reads a brand, schedules a post, publishes to a platform, or holds a client's approval. It is the *first ten minutes* of PersonaGen — generate an image — offered as the whole thing.
- **We already own every rail it sells.** The markup knob is `credit_markup` in `platform_settings`. The Stripe path is [stripe.ts](../../personagen-svelte/src/lib/server/stripe.ts) waiting for keys. Studio toggles are plan entitlements. End-user credit adjustment is the platform admin console. We would be paying to rent a worse copy of things we built.
- **One instance per account** (their FAQ) versus our workspaces-with-seats. An agency running ten client brands is our core buyer and their explicit non-fit.
- **No data export is documented anywhere.** Termination clause: *"Upon termination, you may lose access to your data and outputs."* Our customers' generations would be hostages.
- **No moderation tooling** beyond ban/unban, on a platform that markets "Spicy" models in its footer while its ToS bans sexual content. Our positioning is brand-safe and client-accountable; we cannot put that promise on infrastructure we do not control.
- **Liability cap: the lesser of six months' fees or $100.** Indemnity runs one way, from us to them. Governing law: India, Bangalore courts.

**What it would cost if done anyway.** $149/mo (Growth, for all studios) + generation at their rates + the entire PersonaGen product turned off. There is no version of this that is not a downgrade.

### 3.2 Option B — muapi as a provider behind our registry

**What it would mean.** A `muapi` provider alongside `fal` and `openrouter` in `model_registry`; catalogue sync from their OpenAPI; our adapters call `POST /api/v1/<model>` and poll `/predictions/{id}/result`; cost fetched from `/app/calculate_dynamic_cost` at quote time; billed through our ledger at our markup. Technically this is the pattern we already run for two providers.

**Where it helps — their rates against what we pay today** (their playground pages, our [pricing.ts](../../personagen-svelte/src/lib/pricing.ts)):

| Model | muapi | Our current row | Delta |
|---|---|---|---|
| Nano Banana 2, 1k image | **$0.06** ($0.09 at 2k, $0.12 at 4k) | fal $0.08; OpenRouter $0.077 | muapi ~25% cheaper at 1k |
| Kling 3.0 standard i2v, 5 s | **$0.72** (their page: "Fal.ai $0.90") | fal kling-o3-standard **$0.42**; OpenRouter kling-v3.0-std **$0.35** | **muapi 71–106% dearer** |
| ElevenLabs Turbo 2.5 | **$0.05 per 1,000 characters** | fal, flat **$0.03** per call | a 150-char line ≈ $0.0075 on muapi vs $0.03 flat — cheaper per short line; our row is a flat stand-in, not a measured per-char rate |
| OmniHuman 1.5, 5 s at 1080p | **$0.06/sec → $0.30** | fal **$0.14/sec → $0.70** | **muapi 57% cheaper** |
| Whisper | $0.012/min | not wired | — |

So: a real saving on talking-head video and a small one on stills; a real loss on Kling, which is our default b-roll. Not a wholesale switch; at most a per-model route.

**Why not now.**

1. **Their ToS §4: *"Use our APIs to build competing services."*** PersonaGen sells agencies a hosted, branded generation product with per-user credits and markup. So does their white-label. A provider relationship on that clause needs their written answer, not our reading of it.
2. **Keys are unscoped.** *"An API key has full access to its account, same as the account holder."* Our BYOK model stores per-tenant provider secrets; a leaked muapi key is a leaked wallet and account. The OAuth2 client-credentials flow with `generate:write` / `generate:read` scopes exists in the spec and would be the only acceptable form.
3. **No refund on a failed generation.** Refund policy: *"Once credits are consumed, refunds cannot be issued under any circumstances."* Our ledger's own rule is that a provider call that threw is never billed to the customer — with muapi we would eat that cost ourselves on every failure, silently.
4. **Cost is not on the contract.** Zero price fields in the OpenAPI or in `models_dump.json`. Every quote is a second API call, and our quote-before-spend invariant depends on the quote being an upper bound. `/app/calculate_dynamic_cost` would have to be proven to be one.
5. **The realism chain lesson applies.** Their Topaz upscaler is *"$0.08+ per started 2 megapixels of output (plus margin), billed dynamically"* — the same unquotable basis [realism-chain-feasibility-2026-09-09.md](realism-chain-feasibility-2026-09-09.md) refused to wire.
6. **Liability cap $100, one-way indemnity, no IP indemnity on outputs** (*"Outputs may include copyrighted or offensive content. You are responsible for monitoring"*), Bangalore jurisdiction, immediate termination with loss of outputs.

**When it might be right.** As a *failover* route for `talking_head` and `image_t2i` behind the existing never-brick fallback, after (1) is answered in writing and (2) is done over OAuth scopes. That is a registry row and an adapter — a day's work on rails we have — but it should wait until there is a reason beyond a lower price on two rows.

### 3.3 Option C — fork or embed the MIT code

**What it would mean.** Mount `ImageStudio` / `VideoStudio` from `packages/studio` inside our portal as a "Studio" tab, pointed at our engine.

**Why no.**

- **It is hardwired to muapi.** The lifecycle helper builds `${baseUrl}/api/v1/predictions/${id}/result` and sends `x-api-key`. To point it at us we would implement muapi's API surface over our engine — a compatibility shim whose only customer is a UI we did not write.
- **Wrong framework.** React 19 components inside a SvelteKit app: a second renderer, a second bundle, two design systems. `VideoStudio.jsx` alone is 144 KB of source.
- **Wrong shape.** Their studios are free-prompt, model-picker-first surfaces. Ours are persona-bound, brand-grounded, quoted-before-spend. The "AI Influencer Studio" in their package is 46 KB of JSX; our persona surface is a five-stage reference kit with an identity contract and a preview→lock wizard.
- **The MIT licence is the only thing that is clean about this**, and it does not make the code fit.

**What is worth reading in it.** The per-model dynamic parameter controls (`ModelParameterControls.jsx`, `imageInputContracts.js`) — a schema-driven form over each model's input contract. Our Model Manager already stores per-model modes and prices; a schema-driven parameter form is a reasonable P2 for our composer. Read it; don't import it.

---

## 4. Legal and policy — the vendor-risk table

From `muapi.ai/terms` (effective 2025-07-02), `refund-policy` (2026-04-04), `docs/white-label`:

| Clause | Text or fact | Effect on us |
|---|---|---|
| Competing services | *"Use our APIs to build competing services"* is prohibited (§4) | Blocks option B without written clearance |
| Output ownership | *"You retain rights to your Inputs and Outputs."* but *"We retain rights to … generated Resultant Data"* — a capitalised term **not defined** in §1 | Ambiguous; would need clarification before any customer-facing use |
| Acceptable use | Bans nudity, sexually explicit, deepfakes, non-consensual synthetic media | Aligned with our settled policy — but see next row |
| Marketing vs terms | Footer markets "Wan Spicy", "Seedance Spicy", "AI Spicy Video Generator"; repo topic `uncensored`, README "no content filters" | A brand-safe product cannot sit on a platform whose public face contradicts its terms |
| Liability | *"limited to the amount paid by you in the past 6 months, or $100, whichever is less"* | Uninsurable for a client-accountable business |
| Indemnity | One-way, from customer to muapi; none for output IP | We would carry every IP claim on their outputs |
| Refunds | Consumed credits *"non-refundable … under any circumstances"*; failed generations are not a refund ground; chargebacks suspend the account | Contradicts our "never billed for a provider that threw" |
| Termination | *"suspend or terminate … Upon termination, you may lose access to your data and outputs."* No notice, cure period, or export window | Customer data hostage risk |
| Data export (white-label) | Not documented | Same |
| Retention | Not stated in ToS; privacy policy is a PDF | Unknown |
| Jurisdiction | Laws of India; courts of Bangalore, Karnataka | — |
| Key scope | Unscoped API keys with full account access (OAuth scopes available) | BYOK unsafe without OAuth |

---

## 5. What to take — ranked, and none of it needs them

| # | Item | Where it lands | Cost |
|---|---|---|---|
| 1 | **Sandbox mode**: a full compose→quote→"generate" path returning a stamped sample image and charging nothing, for evaluation and demos | A `sandbox` flag on the composer honoured by `generate-post` and `persona-preview`, returning fixtures; the `$0` card renderer already proves the never-spend pattern | Small; reuses the fixture account from `seed-fixture.mjs` |
| 2 | **Recurring free media credits** as an operator setting | `platform_settings` knob next to `signup_credits`, applied monthly by the scheduler | Small; closes a Fannabe finding too |
| 3 | **Public rate card** generated from `pricing.ts` with the same competitor columns muapi shows | A `/pricing/models` page; the numbers already exist and are already asserted by `landing-price-claims.spec.ts` | Trivial |
| 4 | **Schema-driven parameter controls** per model in the composer | Model Manager already stores modes/prices; add input schemas | P2 |
| 5 | muapi as an OAuth-scoped failover provider for `talking_head` / `image_t2i` | Registry row + adapter | A day — **after** a written answer on §4 |

---

## 6. Risks of *not* doing any of this

Low. The white-label studio addresses buyers who want a generic generation product under their brand. Our buyer wants an account run. The one place their offer beats ours for our own buyer — the first ninety seconds, before a persona exists — is the same gap the Fannabe assessment already ranked P0, and P0.3 shipped on 2026-09-17. Sandbox mode (item 1) is the remaining piece of that ninety seconds, and it is ours to build in a day.

---

## 7. Bottom line

The white-label studio is a well-built answer to a question we are not asking. It sells a hosted, rebrandable, generic generation UI with billing attached, to people who have no product. We have a product, and every rail the studio sells — wallet, markup, Stripe, entitlements, seats, per-run quotes, a ledger that tells the truth — already exists in it, built around personas, brands and publishing that their studio does not have.

The open-source repo is the top of their funnel: MIT code that can only talk to their API, with the end user's key in the browser. Embedding it would mean serving their API from our engine to host a UI worse aligned with our product than the one we already ship.

Using muapi as a *provider* is the only reading with technical merit — the API is fal-shaped and our adapters already speak it, and two of our rows would get cheaper — and it is blocked by a competing-services clause, unscoped keys, no refund on failed calls, and a $100 liability cap. Ask them the clause question in writing if the talking-head saving ever matters; otherwise leave it.

Take sandbox mode and recurring free credits. Both are a day each, both close gaps two competitors have now exposed, and neither requires a vendor.

---

## Sources

- [muapi.ai/white-label-ai-studio](https://muapi.ai/white-label-ai-studio), [muapi.ai](https://muapi.ai/), [muapi.ai/pricing](https://muapi.ai/pricing) — fetched 2026-09-19
- [muapi.ai/terms](https://muapi.ai/terms), [muapi.ai/refund-policy](https://muapi.ai/refund-policy), [muapi.ai/docs/white-label](https://muapi.ai/docs/white-label), [muapi.ai/docs/introduction](https://muapi.ai/docs/introduction) — fetched 2026-09-19
- `https://api.muapi.ai/openapi.json` — 2,219,900 bytes, 1,107 paths, fetched 2026-09-19
- muapi playground pages for `nano-banana-2`, `kling-v3.0-standard-image-to-video`, `elevenlabs-tts-turbo-2-5`, `omnihuman-1-5`, `openai-whisper`; marketing pages `/nano-banana-api`, `/kling-3`, `/elevenlabs-api`, `/infinite-talk`
- [github.com/anil-matcha/open-generative-ai](https://github.com/anil-matcha/open-generative-ai) — README, LICENSE, `package.json`, `docker-compose.yml`, `.gitmodules`, `app/api/app/[[...path]]/route.js`, `app/api/api/v1/[[...path]]/route.js`, `components/ApiKeyModal.js`, `packages/studio/package.json`, `packages/studio/src/utils/generationLifecycle.js`, `models_dump.json`; GitHub API repo metadata and tree
- PersonaGen: `pricing.ts`, `plans.ts`, `workspaces.ts`, `model-registry.ts`, `formats.ts`, `providers.ts`, `api-keys.ts`, `credits.ts`, `stripe.ts`
- Companion: [fannabe-viability-assessment-2026-09-09.md](fannabe-viability-assessment-2026-09-09.md), [hypit-integration-viability-2026-09-17.md](hypit-integration-viability-2026-09-17.md), [realism-chain-feasibility-2026-09-09.md](realism-chain-feasibility-2026-09-09.md)
