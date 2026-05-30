# Project Tracker — {{client.name}}

**Platform:** PersonaGen | **Provider:** Monarch Stack — Fractional CTO
**Document Type:** Living Operational — Updated Throughout Engagement
**Version:** 1.0 | **Last Updated:** {{effective_date}}

> Operational status for every milestone, decision, and request. For technical details on any component referenced here, see [System Playbook](./02-system-playbook.md).

---

## Changelog

| Version | Date | Change |
|---------|------|--------|
| 1.0 | {{effective_date}} | Project initiated |
| 1.1 | 2026-05-24 | Direct API posting verified — Create/Read/Update proven live |
| 1.2 | 2026-05-25 | MSA §7 IP rewritten (perpetual client ownership), §1 Scope updated (client-owned accounts), §10 Infrastructure named stack added |
| 1.3 | 2026-05-25 | Invoice reissued — $2,500 due May 28, 2026. Prior duplicates voided |
| 1.4 | 2026-05-29 | Client config completed — rep_name, email, effective_date populated |
| 1.5 | 2026-05-30 | Scout Intelligence Engine 2.0 — Channel Decoder + Content Forge modules deployed, agent configs updated |

---

## Status Board

| # | Workstream | Status | Owner | ETA |
|---|-----------|--------|-------|-----|
| 1 | Agreement & Payment | ▶ | Client + Monarch | Days 1–2 |
| 2 | Brand Discovery | ☐ | Client + Monarch | Day 3 |
| 3 | Infrastructure Setup | ☐ | Client + Monarch | Days 4–5 |
| 4 | Platform Build | ☐ | Monarch | Weeks 1–3 |
| 5 | Distribution Network | ▶ | Client + Monarch | Weeks 3–4 |
| 6 | Go-Live | ☐ | Monarch | ~Day 30 |

**Key:** ☐ Backlog · ▶ In Progress · ✦ Review · ✔ Live · ✘ Blocked

---

## Phase Milestones

### Phase 1 — Agreement & Payment

| Milestone | Owner | Status | Date |
|-----------|-------|--------|------|
| MSA signed | Client | ▶ | MSA v1.4 delivered 2026-05-29 |
| Payment processed | Client | ▶ | Invoice sent — due 2026-05-28 |
| WhatsApp channel live | Monarch | ✔ | Active |
| Onboarding packet delivered | Monarch | ✔ | 3-doc set delivered |

### Phase 2 — Brand Discovery

| Milestone | Owner | Status | Date |
|-----------|-------|--------|------|
| Brand brief completed | Client | ☐ | — |
| Brand assets received | Client | ☐ | — |
| Persona archetypes defined | Monarch | ☐ | — |
| Brand voice document compiled | Monarch | ☐ | — |

### Phase 3 — Infrastructure
*Setup procedures: [Playbook §3](./02-system-playbook.md#3-setup-guide)*

| Milestone | Owner | Status | Date |
|-----------|-------|--------|------|
| All client accounts created | Client | ☐ | — |
| VPS provisioned (EasyPanel + Docker + n8n) | Monarch | ☐ | — |
| OpenRouter + BYOK configured | Monarch | ☐ | — |
| DNS + SSL active | Monarch | ☐ | — |
| Security hardened | Monarch | ☐ | — |
| **Infrastructure health check: all green** | Monarch | ☐ | — |

### Phase 4 — Platform Build

| Milestone | Owner | Status | Date |
|-----------|-------|--------|------|
| Content pipeline deployed | Monarch | ☐ | — |
| Media engine deployed | Monarch | ☐ | — |
| Persona database + scheduler live | Monarch | ☐ | — |
| Analytics dashboard live | Monarch | ☐ | — |
| Channel Decoder module deployed | Monarch | ✔ | 2026-05-30 |
| Content Forge module deployed | Monarch | ✔ | 2026-05-30 |
| Agent blueprint integration complete | Monarch | ✔ | 2026-05-30 |
| Persona set generated | Monarch | ☐ | — |
| **Client approval on personas** | Client | ☐ | — |

### Phase 5 — Distribution Network
*Device specs & architecture: [Playbook §5](./02-system-playbook.md#5-execution-network)*

| Milestone | Owner | Status | Date |
|-----------|-------|--------|------|
| Devices identified + assigned | Client | ☐ | — |
| Daemon scripts deployed | Monarch | ☐ | — |
| Account creation tested per device | Monarch | ☐ | — |
| Direct API posting verified (CRUD) | Monarch | ✔ | 2026-05-24 |
| Session cookie maintenance documented | Monarch | ✔ | 2026-05-24 |
| Fingerprint + IP verified | Monarch | ☐ | — |
| **Network operational** | Monarch | ☐ | — |

### Phase 6 — Go-Live

**11-Point Smoke Test:**

| # | Criterion | Pass |
|---|----------|------|
| 1 | Containers healthy, auto-restarting | ☐ |
| 2 | DNS resolving | ☐ |
| 3 | SSL valid, auto-renewing | ☐ |
| 4 | Persona output brand-aligned | ☐ |
| 5 | Scheduler posting on cadence | ☐ |
| 6 | Analytics receiving live data | ☐ |
| 7 | Devices posting via real fingerprints | ☐ |
| 8 | Auto-posting verified (1+ platform) | ☐ |
| 9 | Source code in Client's GitHub | ☐ |
| 10 | Live walkthrough completed | ☐ |
| 11 | First production post published | ☐ |
| 12 | Channel Decoder renders blueprint (demo + live) | ☐ |
| 13 | Content Forge generates content package | ☐ |
| 14 | Blueprint → Agent feed pipeline verified | ☐ |

**Handoff:**

| Deliverable | Status |
|------------|--------|
| Source code (Client is owner) | ☐ |
| Credential bundle | ☐ |
| Playbook updated to final state | ☐ |
| Device setup guide | ☐ |

---

## Decision Log

| # | Date | Decision | Rationale | By |
|---|------|----------|-----------|----|
| 1 | {{effective_date}} | Cloud-first infra | VPS + OpenRouter start. RunPod at 500+ img/mo. | Joint |
| 2 | {{effective_date}} | On-premise posting | Existing Macs as execution nodes. $0 cost, max stealth. | Joint |
| 3 | {{effective_date}} | BYOK injection | Direct provider keys save 5–10%. | Monarch |

---

## Ticket Log

| # | Date | Type | Description | Status | Resolved |
|---|------|------|------------|--------|----------|
| — | — | — | No tickets yet | — | — |

**Types:** Tweak (< 24hr) · Feature (2–5 days) · System (1–3 weeks)

---

## Scaling Triggers
*Technical thresholds & pricing: [Playbook §6](./02-system-playbook.md#6-scaling-roadmap)*

| Metric | Current | Threshold | Action |
|--------|---------|-----------|--------|
| Images/month | — | 500+ | RunPod GPU evaluation |
| Active personas | — | 20+ | VPS tier upgrade |
| Posting devices | — | 10+ | Network segmentation |
| AI spend/month | — | $100+ | BYOK audit |
| Container memory | — | 80%+ | VPS upgrade |
| Post failure rate | — | 5%+ | Debug sprint |

---

## Operations Cadence

| Cadence | Activity | Owner |
|---------|----------|-------|
| Daily | Content generation + posting | System |
| Daily | Queue health + device status | Monarch |
| Weekly | Performance review + strategy adjust | Monarch |
| Monthly | Analytics report (WhatsApp) | Monarch |
| Monthly | Cost review + optimization | Monarch |
| Every 60 days | Session cookie refresh (per device) | Client + Monarch |
| Quarterly | Architecture review + roadmap | Joint |
| As needed | Tickets | Client → Monarch |

---

## Communication

| Channel | Purpose | SLA |
|---------|---------|-----|
| **WhatsApp** | Primary — requests, updates, approvals | < 4hr / < 2hr / < 1hr |
| **GitHub** | Technical — code, deploys, issues | < 24hr |
| **This Tracker** | Strategic — decisions, milestones | Updated weekly minimum |

---

*Monarch Stack — Fractional CTO Services*
*Living document. All changes logged in the Changelog above.*
