# System Playbook — {{client.name}}

**Platform:** PersonaGen | **Provider:** Monarch Stack — Fractional CTO
**Document Type:** Living Reference — Updated Throughout Engagement
**Version:** 1.0 | **Last Updated:** {{effective_date}}

> Your complete technical blueprint — architecture, setup procedures, costs, and scaling roadmap. This is the single source of truth for how your platform works. For live project status and milestone tracking, see [Project Tracker](./03-project-tracker.md).

---

## Changelog

| Version | Date | Change |
|---------|------|--------|
| 1.0 | {{effective_date}} | Initial architecture — VPS + OpenRouter + on-premise posting network |
| 1.1 | 2026-05-30 | Scout Intelligence Engine 2.0 — Channel Decoder, Content Forge, Blueprint pipeline |
| 1.2 | 2026-06-05 | Client deployment target and live environment aligned to personagendemo.pages.dev; Content Intelligence Wizard 6-stage pipeline explicitly documented. |

---

## 1. Architecture

```
       ┌───────────────────────────────────────────────┐
       │      Central Coordinator (Your Cloud VPS)     │
       │   • Content generation via OpenRouter         │
       │   • Persona database & scheduling queue       │
       │   • n8n automation workflows                  │
       │   • Analytics & monitoring                    │
       └──────────────────────┬────────────────────────┘
                              │ HTTPS polling
             ┌────────────────┼────────────────┐
             ▼                ▼                ▼
     ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
     │ Your Mac A   │ │ Your Mac B   │ │ Your Mac C   │
     │ [Persona 1]  │ │ [Persona 2]  │ │ [Persona 3]  │
     │ • Real GPU   │ │ • Real GPU   │ │ • Real GPU   │
     │ • Home IP    │ │ • Home IP    │ │ • Home IP    │
     │ • Real HW ID │ │ • Real HW ID │ │ • Real HW ID │
     └──────────────┘ └──────────────┘ └──────────────┘
           Execution Nodes (Your On-Premise Devices)
```

**Data flow:** VPS generates content → queues post → on-premise device polls → downloads media → posts via real browser → reports status back to VPS.

---

## 2. Stack Components

### 2.1 Cloud Layer

| Component | Technology | Account Owner | Setup Guide |
|-----------|-----------|---------------|-------------|
| Hosting | Hostinger VPS (KVM) | Client | [§3.1](#31-hostinger-vps) |
| Orchestration | EasyPanel + Docker | Client (Monarch manages) | Provisioned by Monarch |
| AI Gateway | OpenRouter | Client | [§3.2](#32-openrouter) |
| Automation | n8n (self-hosted) | Client (Monarch manages) | Provisioned by Monarch |
| CDN & Security | Cloudflare | Client | [§3.3](#33-cloudflare) |
| Code | GitHub | Client (Monarch collaborator) | [§3.4](#34-github) |
| Voice | ElevenLabs | Client | [§3.5](#35-elevenlabs) |

### 2.2 On-Premise Layer

| Device | Assigned Persona | IP Type | Status |
|--------|-----------------|---------|--------|
| Mac A | — | Residential | ☐ Pending |
| Mac B | — | Residential | ☐ Pending |
| Mac C | — | Residential | ☐ Pending |

### 2.3 Intelligence & Content Layer

| Module | Technology | Purpose |
|--------|-----------|----------|
| Channel Decoder | `modules/channel-decoder.js` (IIFE) | 9-layer reverse-engineering of competitor channels (YouTube/TikTok/Instagram) |
| Content Forge | `modules/content-forge.js` (IIFE) | Blueprint-to-production content package pipeline (titles, hooks, scripts, thumbnails, multi-platform) |
| Blueprint Library | `data/blueprints.json` + localStorage | Persistence layer for decoded channel blueprints |
| Trend Monitor | `modules/trends.js` (IIFE) | Real-time trend scanning across niches and platforms |
| Scout Intelligence | `script.js` (scout section) | Profile analysis + keyword/trend discovery engine |

**Webhook Endpoints (n8n):**

| Endpoint | Purpose |
|----------|---------|
| `personagen-channel-decode` | Channel reverse-engineering (YouTube API + AI analysis) |
| `personagen-content-forge` | Blueprint → production content generation |
| `personagen-blueprints` | Agent blueprint injection (Feed Blueprint → Agent) |
| `personagen-trends` | Trend scanning and enrichment |
| `personagen-social` | Account connections |
| `personagen-posts` | Post CRUD + calendar |
| `personagen-ai-generate` | AI persona/content generation |
| `personagen-publish` | Publishing pipeline |
| `personagen-engagement` | Inbox management |
| `personagen-account-factory` | Automated account creation |
| `personagen-email` | Email/SMS operations |

---

## 3. Setup Guide

> These are the accounts you create and own. We guide you through each step via WhatsApp.

### 3.1 Hostinger VPS

- Create account at [hostinger.com/vps](https://hostinger.com/vps)
- Share root credentials via WhatsApp
- Monarch provisions EasyPanel + Docker + n8n on your VPS

| Tier | Specs | Monthly | Recommendation |
|------|-------|---------|----------------|
| KVM 1 | 1 vCPU, 4GB RAM, 50GB NVMe | ~$6.50 | Light workloads |
| **KVM 2** | **2 vCPU, 8GB RAM, 100GB NVMe** | **~$10–15** | **Standard** |
| KVM 4 | 4 vCPU, 16GB RAM, 200GB NVMe | ~$18–25 | Heavy workloads |
| KVM 8 | 8 vCPU, 32GB RAM, 400GB NVMe | ~$40–80 | Enterprise |

**Current selection:** ☐ TBD

### 3.2 OpenRouter

- Create account at [openrouter.ai](https://openrouter.ai)
- Add payment method, load initial $25–50 in credits
- Share API key via WhatsApp
- Monarch configures model routing

### 3.3 Cloudflare

- Create account at [cloudflare.com](https://cloudflare.com) (free tier)
- Add your domain or we provision a subdomain
- Share account access — Monarch configures DNS + SSL

### 3.4 GitHub

- Create account at [github.com](https://github.com) (or use existing)
- Share username — Monarch creates repo and adds you as owner

### 3.5 ElevenLabs

- Create account at [elevenlabs.io](https://elevenlabs.io) — Creator plan ($22/mo)
- Share API key via WhatsApp

### 3.6 BYOK — Optional Cost Optimization

OpenRouter charges a **5.5% surcharge** on credits purchased through them, plus a **5% usage fee** on BYOK requests after the first 1M/month. To cut this:

| Provider | What It Powers | Direct Account | BYOK Injected |
|----------|---------------|---------------|--------------|
| Anthropic | Claude (text) | [console.anthropic.com](https://console.anthropic.com) | ☐ |
| Black Forest Labs | FLUX.2 (images) | [api.bfl.ml](https://api.bfl.ml) | ☐ |
| OpenAI | GPT (text) | [platform.openai.com](https://platform.openai.com) | ☐ |

First 1M BYOK requests/month are free. Saves 5–10% on all AI spend at scale.

### 3.7 On-Premise Devices

Your existing Macs serve as dedicated posting and account creation nodes. One device per persona.

**Assignment table** (populated during distribution phase):

| Device | Model | Persona | Setup Complete |
|--------|-------|---------|---------------|
| 1 | — | — | ☐ |
| 2 | — | — | ☐ |
| 3 | — | — | ☐ |
| 4 | — | — | ☐ |
| 5 | — | — | ☐ |

**Per-device requirements:**

| Spec | Minimum | Recommended |
|------|---------|-------------|
| RAM | 8GB | 16GB |
| Storage | 20GB free | 50GB free |
| OS | macOS 13+ | macOS 14+ |
| Network | Wi-Fi | Ethernet (wired) |
| Power | — | Always plugged in |
| Software | Node.js 18+, Playwright | Installed by Monarch |

---

## 4. AI Models & Pricing

### 4.1 Active Models

| Capability | Model | Cost |
|-----------|-------|------|
| Text (primary) | Claude Sonnet 4.6 | $3/1M input, $15/1M output |
| Text (alt) | GPT-5.4 | $2.50/1M input, $15/1M output |
| Text (budget) | Claude Haiku 4.5 | $1/1M input, $5/1M output |
| Images | FLUX.2 Pro | ~$0.04–0.05/image (1080p) |
| Images (premium) | FLUX.2 Max | ~$0.10/image |
| Voice | ElevenLabs Creator | $22/mo (100K chars + cloning) |

### 4.2 Cost Projections

| Activity | Volume | Cost |
|----------|--------|------|
| 50 persona profiles (bio + 3 images + voice) | One-time | $8–15 |
| Daily social copy, 10 personas | Per day | $2–5 |
| Monthly operations (10 personas, daily) | Per month | $60–150 |

---

## 5. Execution Network

### 5.1 Why On-Premise

| Approach | Monthly Cost | Detection Risk | Reliability |
|----------|-------------|---------------|-------------|
| Datacenter posting | $15–80 | **High** | Moderate |
| Residential proxies | $50–200 | **Medium** | Low–Moderate |
| **Your on-premise devices** | **$0** | **Minimal** | **High** |

### 5.2 How It Works

1. **Assignment** — One Mac per persona, physically air-gapped
2. **Session Capture** — One-time manual login via headful browser, cookies saved locally (~30s)
3. **Direct API Posting** — Zero-browser HTTP calls to Instagram's internal REST API
4. **Stealth** — Authentic hardware fingerprints, residential IP, session cookies from real login

**Posting flow (proven & deployed):**
```
Node.js script → Upload image (HTTP POST to i.instagram.com/rupload_igphoto/)
              → Publish post (HTTP POST to www.instagram.com/api/v1/media/configure/)
              → ~3 second total latency, zero browser overhead
```

**Full CRUD operations available:**

| Operation | Method | Latency | Browser Required |
|-----------|--------|---------|------------------|
| **Create** | Direct API | ~3s | No |
| **Read** | Direct API | <1s | No |
| **Update** (caption) | Direct API | <1s | No |
| **Delete** | Browser context | ~8s | Yes (Puppeteer) |
| **Feed list** | Direct API | <1s | No |
| **Health check** | Direct API | <1s | No |

### 5.3 Stealth Properties

- **Hardware:** Authentic WebGL, GPU signatures, screen dimensions
- **Network:** Residential ISP — no datacenter or proxy artifacts
- **Air-gapping:** Separate physical hardware per persona — no cross-linking
- **Profiles:** Persistent session cookies from real browser login — identical to normal user
- **API Method:** Same internal endpoints Instagram's own web app uses

### 5.4 Session Cookie Maintenance

| Cookie | Lifespan | Risk Level |
|--------|----------|------------|
| `sessionid` | 365 days | Low |
| `csrftoken` | 400 days | Low |
| `ds_user_id` | 90 days | **First to expire (High)** |

**Maintenance schedule:**
- **Day 60:** Preventive session refresh (re-run login capture, ~30s)
- **Before every post:** Automated health check via feed endpoint
- **On failure:** Re-run `capture_session.js` on the on-premise device

**Session invalidation triggers:**
- Password change → re-capture required
- "Log out all sessions" → re-capture required
- Suspicious login detection → re-capture + verify
- 2FA changes → re-capture required

---

## Account Factory — Automated Account Creation

### Architecture

The Account Factory extends the execution network (§5) with two dedicated Docker services that automate persona account creation end-to-end. Both services deploy from the same repo using separate Dockerfiles, portable across any Docker host via Easypanel.

```
┌──────────────────────────────────────────────────────┐
│              Central Coordinator (VPS)               │
│   • n8n triggers creation jobs                       │
│   • Dashboard monitors pipeline status               │
│   • Persona DB supplies identity profiles            │
└────────────────────┬─────────────────────────────────┘
                     │ HTTPS / Internal Docker Network
        ┌────────────┴────────────┐
        ▼                         ▼
┌──────────────────┐   ┌──────────────────┐
│ personagen-      │   │ personagen-      │
│ factory          │   │ mail             │
│ ─────────────    │   │ ─────────────    │
│ CloakBrowser +   │◄──│ AgenticMail      │
│ Playwright       │   │ SMTP/IMAP/API    │
│ Stealth profiles │   │ DKIM-signed      │
│ Proxy routing    │   │ AI-drafted reply │
│ Session storage  │   │ Verification     │
└──────────────────┘   └──────────────────┘
   services/factory/      services/mail/
   Dockerfile             Dockerfile
```

### Services

| Service | Technology | Purpose |
|---------|-----------|---------|
| `personagen-factory` | CloakBrowser (npm dep) + Playwright | Stealth browser automation — navigates sign-up flows with anti-detect fingerprinting, proxy rotation, and CAPTCHA solving |
| `personagen-mail` | AgenticMail | Dedicated email identity layer — creates per-persona mailboxes, receives verification codes, sends DKIM-signed emails, drafts AI replies |

### Pipeline Steps

The factory executes a multi-step pipeline for each account creation:

1. **Identity Generation** — Pull persona profile from the persona database (name, bio, photos, voice)
2. **Email Provisioning** — Request a dedicated `persona@yourdomain.com` mailbox from AgenticMail
3. **Browser Launch** — Spin up a CloakBrowser instance with stealth fingerprint, configured proxy, and fresh profile
4. **Sign-Up Flow** — Navigate the target platform's registration pages with human-like delays and interactions
5. **Email Verification** — AgenticMail receives the verification email, extracts the code/link, feeds it back to the factory
6. **SMS Verification** — Google Voice integration forwards SMS codes when phone verification is required
7. **Profile Setup** — Upload avatar, set bio, configure privacy settings via the platform's UI
8. **Session Capture** — Export browser cookies and session tokens, encrypt with AES-256, store to the factory database
9. **Callback** — POST status and session data to the n8n webhook for pipeline orchestration

### Session Management Alignment

The factory's session capture (step 8) produces the same cookie artifacts documented in §5.4:

| Cookie | Source | Lifespan | Maintenance |
|--------|--------|----------|-------------|
| `sessionid` | Factory capture | 365 days | Auto-refresh at day 60 |
| `csrftoken` | Factory capture | 400 days | Auto-refresh at day 60 |
| `ds_user_id` | Factory capture | 90 days | **First to expire — auto-refresh at day 60** |

Sessions captured by the factory are **identical** to sessions from the manual capture flow (§5.2). The on-premise execution nodes consume these sessions transparently — they don't know or care whether the session came from manual login or automated creation.

Health checks run every 24 hours. The factory automatically re-creates sessions that fail health checks, using the same proxy tier and fingerprint profile as the original creation.

### Email Identity Layer

AgenticMail gives each persona a **real, deliverable email address** on the client's domain:

- **Inbound:** Receives platform notifications, verification emails, DM notifications, and fan mail
- **Outbound:** Sends DKIM-signed emails from the persona's address (brand partnerships, collaborations)
- **AI Replies:** When `AI_REPLY_ENABLED=true`, drafts contextual replies using the persona's voice profile
- **Unified Inbox:** All persona mailboxes surface in the dashboard's unified inbox for human review and override
- **Verification Flow:** Verification codes are extracted automatically and fed back to the factory pipeline — no human intervention needed

> For deployment instructions, see the [Account Factory Client Delivery Guide](../client-delivery/README.md).

---

## 6. Scaling Roadmap

### 6.1 GPU Cloud — RunPod (Future)

**Transition trigger:** 500+ images/month consistently, or adding video generation.

| Volume | OpenRouter Cost | RunPod Cost | Winner |
|--------|----------------|-------------|--------|
| Under 250 images | $5–25 | ~$8 | OpenRouter |
| 500+ images | $25–50+ | ~$8–16 | **RunPod (2–3x cheaper)** |
| 1,000+ images + video | $70–150+ | ~$22–30 | **RunPod (5x cheaper)** |

| GPU | Rate | Billing |
|-----|------|---------|
| A100 (80GB) | ~$2.72/hr | Per-second, scales to zero |
| H100 (80GB) | ~$4.18/hr | Per-second, scales to zero |

**Why cloud, not more Macs?** One A100 (~$2.72/hr) delivers ~500+ tok/s batched. One Mac M4 Max does ~10–15 tok/s. Matching one A100 requires 5–6 Macs (~$20K+). Macs are optimally deployed as posting nodes.

**Status:** ☐ Not yet needed

---

## 7. Monthly Cost Ledger

| Component | Monthly Cost | Paid By |
|-----------|-------------|---------|
| Hostinger VPS | $6.50–80 | Client |
| OpenRouter / AI tokens | $30–150 | Client |
| ElevenLabs | $22 | Client |
| Cloudflare | Free | Client |
| GitHub | Free | Client |
| On-premise Macs | $0 (already owned) | — |
| RunPod GPU | TBD (future) | Client |
| **Monarch Stack** | **Per plan tier** | **Subscription** |

**Estimated infrastructure: ~$60–250/month** (excluding management fee)

---

## 8. Security

| Layer | Implementation |
|-------|---------------|
| Transit | TLS 1.3 |
| Server access | SSH key auth, no passwords |
| API keys | Encrypted env vars, never in code |
| Session cookies | AES-256 encrypted at rest, never in plaintext |
| Posting auth | Browser session cookies (httpOnly, domain-locked) |
| DDoS | Cloudflare proxy |
| Backups | Automated weekly (Hostinger) |
| Code ownership | Client is GitHub repo owner |
| Access | Monarch has collaborator access during Agreement |
| Termination | Monarch access revoked within 7 business days |

> **Note:** No OAuth developer tokens, API keys, or app registrations are used for social posting. Session cookies from real browser logins are the sole authentication mechanism — identical to how a human user operates.

---

## 9. Data Ownership

All infrastructure accounts, source code, generated assets, credentials, and data are **exclusively owned by {{client.name}}**. Monarch Stack maintains collaborative management access for the Agreement duration. Upon termination, access is revoked within seven (7) business days. Client retains and continues operating all systems independently.

---

## 10. Key Workflows & Common Pitfalls

### 10.1 Content Intelligence Wizard Workflow (6-Stage Pipeline)
To prevent sequence mistakes during layout changes, feature updates, or E2E testing, the Intelligence Wizard executes in a strict, logically dependent 6-stage sequence. Every step feeds its selected/generated state directly into the next:
1. **Stage 1: Trend Discovery (Trend Monitor)**: Select niche and topic trend (e.g., `tech` ➔ `#Autonomous Coding Agents`). Feeds the chosen topic into Stage 2.
2. **Stage 2: Competitor Channel Explorer (Channel Decoder)**: Find and analyze winning competitor channels related to the trend (e.g., `@devinexplains`). Feeds the competitor profile into Stage 3.
3. **Stage 3: Winning Content (Social Scout)**: View viral content/posts for the selected competitor, and select a high-performing post/video to dissect. Feeds the selected post into Stage 4.
4. **Stage 4: Content Decoder (Holographic Scan)**: Run 9-layer holographic reverse-engineering of the selected viral post (hooks, pacing, visual prompts, scripting style). Captures detailed blueprint parameters to feed into Stage 5.
5. **Stage 5: Feed Agent (AI Agent Training)**: Ingest the generated 9-layer blueprint into the target AI persona's brain. Trigger terminal-based agent training to output topic-specific customized outlines. Feeds customized outlines to Stage 6.
6. **Stage 6: Content Studio (Stages & Production)**: View, refine, and queue newly generated topic-specific custom drafts (complete with hooks, checklists, and visual cues) for automated posting.

> [!WARNING]
> Bypassing stages or out-of-order execution (e.g., trying to run Social Scout before finding competitor channels, or decoding before selecting content) will cause state exceptions. E2E validation scripts (`scratch/verify-intel-wizard.js`) assert this exact sequence.

### 10.2 Client Deployment Target & Live Environment (DO NOT ASSUME)
- **Live Environment URL:** `https://honeyx.monarchstack.com/` (Cloudflare Pages deployment target: `personagen-demo`)
- **Cloudflare Pages Project Name:** `personagen-demo`
- **Auto-deployment Config:** Managed via `clients/honeyforx.config.json` (specifically the `client.domain` attribute).
- **One-Command Deployment Script:** `deploy.ps1`.

> [!CAUTION]
> **CRITICAL DEPLOYMENT ASSUMPTIONS & PITFALLS TO NEVER REPEAT:**
> 1. **DO NOT assume Cloudflare Pages automatically deploys on git push:**
>    * The Cloudflare Pages project is a **Direct Upload** project. Pushing to GitHub updates the repository history, but **IT DOES NOT trigger an automated build on Cloudflare** because the compiled `dist/` directory is in `.gitignore` and no cloud-side build script exists.
>    * **YOU MUST EXPLICITLY RUN THE DEPLOYMENT SCRIPT** to build and upload the SvelteKit app: `powershell -ExecutionPolicy Bypass -File .\deploy.ps1 -skipCommit` (or run `npm run build` inside `personagen-svelte` and deploy `.svelte-kit/cloudflare` via wrangler).
> 2. **DO NOT assume the project name is client-specific or non-hyphenated:**
>    * Never assume the project name is client-specific (e.g., `personagen-honeyforx`) or missing the hyphen (e.g., `personagendemo`).
>    * The correct project name is **`personagen-demo`** (with a hyphen) and the mapped domain is **`honeyx.monarchstack.com`**.
> 3. **DO NOT run wrangler deployment in a non-interactive background agent shell without a token or account ID:**
>    * Wrangler CLI requires a `CLOUDFLARE_API_TOKEN` environment variable (or a cached local Wrangler session) and `CLOUDFLARE_ACCOUNT_ID` when executing in background, non-interactive processes.
>    * If you do not have an API token, you must execute the deploy command interactively on the system or instruct the user to run `npx wrangler pages deploy personagen-svelte/.svelte-kit/cloudflare --project-name personagen-demo` in their terminal where their authenticated Wrangler session is active.

---

*Monarch Stack — Fractional CTO Services*
*Living document. All changes logged in the Changelog above.*
