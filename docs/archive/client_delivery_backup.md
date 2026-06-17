# VERBATIM BACKUP: docs/client-delivery

---

## File: docs/client-delivery/README.md

# Account Factory — Client Deployment Guide

**Platform:** PersonaGen Account Factory  
**Provider:** Monarch Stack — Fractional CTO  
**Document Type:** Client Delivery — Setup Guide  

> Deploy the Account Factory to automate persona account creation with stealth browser automation and dedicated email identities. This guide covers everything needed to go from zero to running.

---

## Prerequisites

Before starting, ensure you have:

| Requirement | Details |
|-------------|---------|
| **Easypanel** | Active Easypanel instance on your VPS ([§ System Playbook](../onboarding/02-system-playbook.md#31-hostinger-vps)) |
| **Cloudflare DNS** | Domain managed via Cloudflare with proxy enabled ([§ System Playbook](../onboarding/02-system-playbook.md#33-cloudflare)) |
| **Google Voice** | Google Voice account with app password for SMS verification forwarding |
| **GitHub Access** | Collaborator access to the PersonaGen repo |
| **Proxy Provider** | At minimum Tier 1 residential proxies for production use (see [Proxy Guide](./proxy-guide.md)) |

---

## Services Overview

The Account Factory consists of **two Easypanel services** deployed from the same repository but using different Dockerfiles:

| Service | Dockerfile | Port | Purpose |
|---------|-----------|------|---------|
| `personagen-mail` | `services/mail/Dockerfile` | 8080 (API), 25 (SMTP), 587 (Submission), 143 (IMAP), 8081 (Health) | AgenticMail — Email identity layer for persona communication |
| `personagen-factory` | `services/factory/Dockerfile` | 8080 | CloakBrowser — Stealth browser automation for account creation |

---

## 3-Step Setup

### Step 1: Create Easypanel Services

In your Easypanel dashboard, create **two services** from the same GitHub repository:

**Service A — `personagen-mail`**

1. Click **+ New Service** → **App**
2. Source: GitHub → select the PersonaGen repo
3. Set **Dockerfile Path** to `services/mail/Dockerfile`
4. Set **Service Name** to `personagen-mail`
5. Enable ports: `8080` (API), `8081` (Health), `25` (SMTP), `587` (Submission), `143` (IMAP)

**Service B — `personagen-factory`**

1. Click **+ New Service** → **App**
2. Source: GitHub → select the PersonaGen repo
3. Set **Dockerfile Path** to `services/factory/Dockerfile`
4. Set **Service Name** to `personagen-factory`
5. Enable port: `8080`

### Step 2: Set Environment Variables

Configure environment variables for each service. See the [Environment Variables Checklist](./env-vars-checklist.md) for the complete reference.

**Minimum required for `personagen-factory`:**

```env
FACTORY_PORT=8080
FACTORY_API_KEY=<generate-a-strong-key>
MAIL_URL=http://personagen-mail:8080
MAIL_API_KEY=<must-match-mail-service-MAIL_API_KEY>
ENGINE_WEBHOOK_URL=https://<your-portal-domain>/webhook/personagen-factory
ENCRYPTION_KEY=<generate-32-byte-hex>
```

**Minimum required for `personagen-mail`:**

```env
MAIL_DOMAIN=mail.<your-domain.com>
MAIL_API_KEY=<generate-a-strong-key>
MAIL_API_PORT=8080
HEALTH_PORT=8081
DKIM_SELECTOR=default
```

> [!IMPORTANT]
> `MAIL_API_KEY` on the factory service **must match** `MAIL_API_KEY` on the mail service. AgenticMail refuses to start without this key so the inbox API cannot accidentally run unauthenticated.

### Step 3: Configure DNS

Add these DNS records in Cloudflare for the mail service:

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| A | `mail` | `<your-vps-ip>` | ❌ DNS only |
| MX | `@` | `mail.<your-domain.com>` | — |
| TXT | `@` | `v=spf1 ip4:<your-vps-ip> ~all` | — |
| TXT | `default._domainkey` | `<DKIM-public-key>` | — |
| CNAME | `factory` | `<easypanel-host>` | ✅ Proxied |

> [!NOTE]
> The mail service **must not** be behind Cloudflare proxy (orange cloud off) — SMTP/IMAP traffic cannot pass through Cloudflare's HTTP proxy. The factory service **should** be proxied for DDoS protection.

---

## Verification

After deployment, verify both services are healthy:

```bash
# Check factory health
curl https://factory.<your-domain.com>/health

# Check mail health
curl http://mail.<your-domain.com>:8080/health

# Test email creation
curl -X POST http://mail.<your-domain.com>:8080/api/inboxes \
  -H "Authorization: Bearer <MAIL_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"address": "test@<your-domain.com>"}'
```

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Factory can't reach mail service | Services not on same Docker network | Ensure both are in the same Easypanel project |
| SMTP connection refused | Port 25 blocked by hosting provider | Contact host to unblock port 25, or use port 587 |
| DKIM validation fails | Missing or incorrect DNS TXT record | Verify `default._domainkey` record matches generated public key |
| Account creation times out | Proxy not responding or blocked | Upgrade proxy tier (see [Proxy Guide](./proxy-guide.md)) |
| Browser detection / captcha loop | Proxy is datacenter or blacklisted | Switch to residential proxy (Tier 1+) |
| `ENCRYPTION_KEY` errors | Key not 32 bytes or not hex-encoded | Generate with: `openssl rand -hex 32` |
| Factory returns 401 | `FACTORY_API_KEY` mismatch | Verify API key matches between caller and factory env var |
| Mail API won't start | `MAIL_API_KEY` not set | Generate and set `MAIL_API_KEY` on both factory and mail services |
| Mail service won't start | `MAIL_DOMAIN` not set | Set the `MAIL_DOMAIN` environment variable |
| Google Voice SMS not forwarding | App password incorrect or 2FA not enabled | Re-generate app password with 2FA enabled on Google account |

---

## Security Notes

> [!CAUTION]
> Never commit API keys, encryption keys, or app passwords to the repository. All secrets must be set as Easypanel environment variables.

- **API Authentication:** Both services require API key auth on all endpoints. Keys are set via environment variables, never hardcoded.
- **Encryption at Rest:** The factory database encrypts sensitive fields (cookies, tokens) with AES-256 using `ENCRYPTION_KEY`.
- **Network Isolation:** Services communicate over Easypanel's internal Docker network. Only exposed ports are accessible externally.
- **DKIM Signing:** All outbound emails are DKIM-signed to prevent spoofing and improve deliverability.
- **Rate Limiting:** `MAX_CREATIONS_PER_DAY` and `COOLDOWN_MINUTES` prevent abuse and reduce detection risk.
- **Proxy Rotation:** Never use your server's real IP for account creation. Always configure a proxy provider.
- **Session Storage:** Browser sessions and cookies are encrypted before persistence. Decryption requires the `ENCRYPTION_KEY`.
- **CORS:** `ALLOWED_ORIGINS` restricts which domains can call the factory API. Set this to your dashboard URL only.

---

## Related Documents

- [Environment Variables Checklist](./env-vars-checklist.md) — Complete env var reference
- [Proxy Guide](./proxy-guide.md) — Proxy tier selection and configuration
- [System Playbook](../onboarding/02-system-playbook.md) — Full architecture reference

---

## File: docs/client-delivery/env-vars-checklist.md

# Environment Variables Checklist — Account Factory

**Platform:** PersonaGen Account Factory  
**Document Type:** Client Delivery — Environment Reference  

> Complete reference for all environment variables across both Account Factory services. Configure these in Easypanel → Service → Environment tab.

---

## Factory Service (`personagen-factory`)

### Core Configuration

| Variable | Required | Default | Description | Example |
|----------|----------|---------|-------------|---------|
| `FACTORY_PORT` | Optional | `8080` | HTTP port the factory API listens on | `8080` |
| `FACTORY_API_KEY` | **Required** | — | API key for authenticating requests to the factory | `af_sk_a1b2c3d4e5f6...` |
| `ENCRYPTION_KEY` | **Required** | — | 32-byte hex key for AES-256 encryption of stored sessions/cookies | `e3b0c44298fc1c14...` (64 hex chars) |
| `ALLOWED_ORIGINS` | Optional | `*` | Comma-separated list of allowed CORS origins | `https://dashboard.yourdomain.com` |

### Mail Integration

| Variable | Required | Default | Description | Example |
|----------|----------|---------|-------------|---------|
| `MAIL_URL` | **Required** | — | Internal URL of the AgenticMail service | `http://personagen-mail:8080` |
| `MAIL_API_KEY` | **Required** | — | API key to authenticate with the mail service (must match mail `MAIL_API_KEY`) | `am_sk_x9y8z7w6...` |

### Proxy Configuration

| Variable | Required | Default | Description | Example |
|----------|----------|---------|-------------|---------|
| `PROXY_HOST` | Optional | — | Proxy server hostname or IP | `us.smartproxy.com` |
| `PROXY_PORT` | Optional | — | Proxy server port | `10001` |
| `PROXY_USER` | Optional | — | Proxy authentication username | `sp_user_abc123` |
| `PROXY_PASS` | Optional | — | Proxy authentication password | `proxy_pass_xyz` |
| `PROXY_TYPE` | Optional | `http` | Proxy protocol type (`http`, `socks5`) | `http` |

> [!TIP]
> Proxy format shorthand: `host:port:user:pass`. The factory accepts either individual env vars or a single `PROXY_URL` in the format `http://user:pass@host:port`.

### CAPTCHA Configuration

| Variable | Required | Default | Description | Example |
|----------|----------|---------|-------------|---------|
| `CAPTCHA_PROVIDER` | Optional | — | CAPTCHA solving service provider (`2captcha`, `anticaptcha`, `capsolver`) | `2captcha` |
| `CAPTCHA_API_KEY` | Optional | — | API key for the CAPTCHA solving service | `2cap_abc123def456...` |

### Engine Integration

| Variable | Required | Default | Description | Example |
|----------|----------|---------|-------------|---------|
| `ENGINE_WEBHOOK_URL` | Optional | — | Engine webhook URL for status callbacks on account creation events | `https://<your-portal-domain>/webhook/personagen-factory` |

### Rate Limiting

| Variable | Required | Default | Description | Example |
|----------|----------|---------|-------------|---------|
| `MAX_CREATIONS_PER_DAY` | Optional | `10` | Maximum number of accounts to create per 24-hour period | `5` |
| `COOLDOWN_MINUTES` | Optional | `15` | Minimum minutes to wait between account creation attempts | `30` |

### Storage

| Variable | Required | Default | Description | Example |
|----------|----------|---------|-------------|---------|
| `PROFILES_DIR` | Optional | `./data/profiles` | Directory path for storing browser profiles and session data | `/app/data/profiles` |
| `DB_PATH` | Optional | `./data/factory.db` | Path to the SQLite database file | `/app/data/factory.db` |

---

## Mail Service (`personagen-mail`)

### Core Configuration

| Variable | Required | Default | Description | Example |
|----------|----------|---------|-------------|---------|
| `MAIL_DOMAIN` | **Required** | — | Domain used for email addresses (must have DNS configured) | `mail.<your-domain.com>` |
| `MAIL_API_KEY` | **Required** | — | API key for authenticating requests to the mail service | `am_sk_x9y8z7w6...` |
| `MAIL_API_PORT` | Optional | `8080` | HTTP port the mail API listens on | `8080` |
| `HEALTH_PORT` | Optional | `8081` | HTTP port for aggregate mail health checks | `8081` |

### Email Server Ports

The current Docker image binds SMTP, Submission, and IMAP listeners in `services/mail/src/entrypoint.sh`. Configure host/Easypanel port exposure rather than environment variables for these listeners.

| Variable | Required | Default | Description | Example |
|----------|----------|---------|-------------|---------|
| SMTP listener | Fixed | `25` | Inbound SMTP listener | `25` |
| Submission listener | Fixed | `587` | Authenticated SMTP/submission listener | `587` |
| IMAP listener | Fixed | `143` | IMAP listener | `143` |

### DKIM Configuration

| Variable | Required | Default | Description | Example |
|----------|----------|---------|-------------|---------|
| `DKIM_SELECTOR` | Optional | `default` | DKIM selector for DNS TXT record lookup | `default` |

### Google Voice Integration

| Variable | Required | Default | Description | Example |
|----------|----------|---------|-------------|---------|
| `GOOGLE_VOICE_EMAIL` | Optional | — | Google account email for Voice SMS forwarding | `yourname@gmail.com` |
| `GOOGLE_VOICE_APP_PASSWORD` | Optional | — | Google app password (16-char, generated with 2FA enabled) | `abcd efgh ijkl mnop` |

> [!WARNING]
> Google app passwords require 2FA to be enabled on the Google account. Generate at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords). This is NOT your Google account password.

### AI Reply Configuration

| Variable | Required | Default | Description | Example |
|----------|----------|---------|-------------|---------|
| `AI_REPLY_ENABLED` | Optional | `false` | Enable AI-drafted replies to inbound emails | `true` |
| `AI_MODEL` | Optional | `claude-haiku-4.5` | AI model for drafting email replies (via OpenRouter) | `claude-sonnet-4.6` |

---

## Quick Copy Template

### Factory `.env`

```env
# === Core ===
FACTORY_PORT=8080
FACTORY_API_KEY=
ENCRYPTION_KEY=
ALLOWED_ORIGINS=https://<your-dashboard-domain>

# === Mail Integration ===
MAIL_URL=http://personagen-mail:8080
MAIL_API_KEY=

# === Proxy (Tier 1+ recommended for production) ===
PROXY_HOST=
PROXY_PORT=
PROXY_USER=
PROXY_PASS=
PROXY_TYPE=http

# === CAPTCHA ===
CAPTCHA_PROVIDER=
CAPTCHA_API_KEY=

# === Engine Callbacks ===
ENGINE_WEBHOOK_URL=

# === Rate Limiting ===
MAX_CREATIONS_PER_DAY=10
COOLDOWN_MINUTES=15

# === Storage ===
PROFILES_DIR=./data/profiles
DB_PATH=./data/factory.db
```

### Mail `.env`

```env
# === Core ===
MAIL_DOMAIN=
MAIL_API_KEY=
MAIL_API_PORT=8080
HEALTH_PORT=8081

# === DKIM ===
DKIM_SELECTOR=default

# === Google Voice ===
GOOGLE_VOICE_EMAIL=
GOOGLE_VOICE_APP_PASSWORD=

# === AI Replies ===
AI_REPLY_ENABLED=false
AI_MODEL=claude-haiku-4.5
```

---

## Key Generation Commands

```bash
# Generate FACTORY_API_KEY
openssl rand -base64 32

# Generate ENCRYPTION_KEY (32-byte hex)
openssl rand -hex 32

# Generate MAIL_API_KEY
openssl rand -base64 32
```

---

## File: docs/client-delivery/proxy-guide.md

# Proxy Strategy Guide — Account Factory

**Platform:** PersonaGen Account Factory  
**Document Type:** Client Delivery — Proxy Reference  

> Proxies are the single most critical factor in account creation success rates. This guide covers the four proxy tiers, when to use each, and how to configure them in the factory service.

---

## Proxy Tier Overview

| Tier | Type | Cost | Success Rate | Use Case |
|------|------|------|-------------|----------|
| **Tier 0** | Own IP | $0/mo | ⚠️ Risky | Local development and testing only |
| **Tier 1** | Budget Residential | ~$1.50–3/GB | 60–75% | Low-volume creation, cost-sensitive deployments |
| **Tier 2** | Standard Residential | ~$7–12/GB | 80–90% | Production use, recommended baseline |
| **Tier 3** | Mobile (4G/5G) | ~$15–30/GB | 90–98% | High-value targets, maximum stealth |

---

## Tier 0 — Own IP (Development Only)

**Cost:** $0  
**When to use:** Local development and testing against non-production targets.

Leave all `PROXY_*` environment variables empty. The factory will use the server's native IP.

> [!CAUTION]
> **Never use Tier 0 for production account creation.** Your server's datacenter IP will be immediately flagged. Accounts created from datacenter IPs are typically banned within hours. Your IP may also be permanently blacklisted, affecting all other services on that server.

---

## Tier 1 — Budget Residential

**Cost:** ~$1.50–3.00/GB  
**Success Rate:** 60–75%  
**Recommended Providers:**

| Provider | Price/GB | Geo Targeting | Rotation | Notes |
|----------|---------|---------------|----------|-------|
| [IPRoyal](https://iproyal.com) | ~$1.75 | Country-level | Per-request or sticky | Good value, pay-as-you-go |
| [PacketStream](https://packetstream.io) | ~$1.00 | Country-level | Per-request | Cheapest option, less reliable |
| [Webshare](https://webshare.io) | ~$2.50 | Country-level | Configurable | Free tier available (not recommended) |

**Best for:** Testing creation flows, low-volume deployments (1–3 accounts/day), budget-conscious clients.

**Limitations:** Higher detection rates, some IPs may be previously flagged, limited geo-targeting granularity.

---

## Tier 2 — Standard Residential

**Cost:** ~$7–12/GB  
**Success Rate:** 80–90%  
**Recommended Providers:**

| Provider | Price/GB | Geo Targeting | Rotation | Notes |
|----------|---------|---------------|----------|-------|
| [SmartProxy](https://smartproxy.com) | ~$7.00 | City-level | Sticky 10–30 min | **Recommended default** |
| [Bright Data](https://brightdata.com) | ~$9.50 | City-level | Configurable | Largest pool, enterprise features |
| [Oxylabs](https://oxylabs.io) | ~$10.00 | City-level | Sticky or rotating | Premium quality, higher minimums |

**Best for:** Production deployments, daily account creation, sustained operations.

**Why this tier works:** These providers maintain large, clean residential IP pools. City-level targeting lets you match proxy location to the persona's supposed location, reducing geographic anomaly flags.

---

## Tier 3 — Mobile (4G/5G)

**Cost:** ~$15–30/GB  
**Success Rate:** 90–98%  
**Recommended Providers:**

| Provider | Price/GB | Network Type | Notes |
|----------|---------|-------------|-------|
| [Soax](https://soax.com) | ~$15.00 | 4G/5G | Good mobile pool, city targeting |
| [Bright Data](https://brightdata.com) | ~$25.00 | 4G/5G | Largest mobile pool |
| 4G Modem (self-hosted) | ~$30–50/mo | 4G LTE | One-time hardware cost, unlimited data |

**Best for:** High-value platforms with aggressive detection, maximum stealth requirements, when budget permits.

**Why mobile IPs work:** Social platforms treat mobile IPs with the highest trust. Thousands of legitimate users share mobile carrier IPs via CGNAT, so these IPs are almost never blocked. This is the gold standard for account creation.

> [!TIP]
> **Self-hosted 4G modem** is the most cost-effective Tier 3 option for sustained operations. A $50 USB modem + $30/mo unlimited data plan gives you a dedicated mobile IP you control. Rotate by toggling airplane mode programmatically.

---

## Configuration

### Environment Variables

Set these on the `personagen-factory` service in Easypanel:

```env
PROXY_HOST=us.smartproxy.com
PROXY_PORT=10001
PROXY_USER=sp_user_abc123
PROXY_PASS=proxy_pass_xyz
PROXY_TYPE=http
```

### Proxy Format

The factory accepts proxies in the standard format:

```
host:port:user:pass
```

**Examples:**

```
# SmartProxy (Tier 2)
us.smartproxy.com:10001:sp_user_abc123:proxy_pass_xyz

# IPRoyal (Tier 1)
geo.iproyal.com:12321:customer_abc:password_123

# Bright Data Mobile (Tier 3)
brd.superproxy.io:22225:brd-customer-abc-zone-mobile:password_xyz

# SOCKS5 proxy
socks5://proxy.example.com:1080:user:pass
```

### Alternative: Single URL Format

Instead of individual env vars, you can use a single `PROXY_URL`:

```env
PROXY_URL=http://sp_user_abc123:proxy_pass_xyz@us.smartproxy.com:10001
```

### Sticky Sessions

For account creation, **sticky sessions are critical**. The entire creation flow (sign-up → email verification → profile setup) must use the same IP address.

Most providers support sticky sessions via a session identifier in the username:

```
# SmartProxy sticky session (30 min)
us.smartproxy.com:10001:sp_user_abc123-session-persona1:proxy_pass_xyz

# Bright Data sticky session
brd.superproxy.io:22225:brd-customer-abc-zone-residential-session-rand123:password_xyz
```

The factory handles session stickiness automatically when `PROXY_HOST` is configured. Override with `PROXY_SESSION_DURATION` (in minutes) if needed.

---

## Proxy Selection Decision Tree

```
Is this for development/testing?
├── Yes → Tier 0 (own IP) — free, test only
└── No → Is budget a primary constraint?
    ├── Yes → Tier 1 (budget residential) — $1.50-3/GB
    └── No → Is the target platform high-detection?
        ├── No  → Tier 2 (standard residential) — $7-12/GB ✅ RECOMMENDED
        └── Yes → Tier 3 (mobile) — $15-30/GB
```

---

## Common Mistakes

> [!WARNING]
> **Free proxies will get every account banned.** Free proxy lists are shared by thousands of users including spammers. These IPs are pre-blacklisted on every major platform. There are no exceptions — do not use free proxies.

| Mistake | Consequence | Fix |
|---------|-----------|-----|
| Using free proxy lists | Instant ban, IP blacklisted | Use paid Tier 1+ providers |
| Using datacenter proxies | High detection, accounts flagged | Switch to residential or mobile |
| Different IP per creation step | Geographic anomaly flag | Enable sticky sessions |
| Proxy location ≠ persona location | Suspicious activity flag | Match proxy geo to persona location |
| Sharing proxy credentials across services | Session collision, bans | Use separate sub-users or zones |
| Not testing proxy before production use | Wasted account creation attempts | Run `curl -x proxy:port ifconfig.me` first |

---

## Cost Estimation

| Volume | Tier 1 Cost | Tier 2 Cost | Tier 3 Cost |
|--------|------------|------------|------------|
| 5 accounts/day (~0.5 GB) | ~$1–2/mo | ~$4–6/mo | ~$8–15/mo |
| 20 accounts/day (~2 GB) | ~$3–6/mo | ~$14–24/mo | ~$30–60/mo |
| 100 accounts/day (~10 GB) | ~$15–30/mo | ~$70–120/mo | ~$150–300/mo |

> [!NOTE]
> Data usage estimates assume ~100MB per account creation flow (browser pages, media uploads, verification). Actual usage varies by platform and flow complexity.
