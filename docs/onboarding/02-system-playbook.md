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

*Monarch Stack — Fractional CTO Services*
*Living document. All changes logged in the Changelog above.*
