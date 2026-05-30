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
| `personagen-mail` | `services/mail/Dockerfile` | 3000 (API), 25 (SMTP), 993 (IMAP) | AgenticMail — Email identity layer for persona communication |
| `personagen-factory` | `services/factory/Dockerfile` | 4000 | CloakBrowser — Stealth browser automation for account creation |

---

## 3-Step Setup

### Step 1: Create Easypanel Services

In your Easypanel dashboard, create **two services** from the same GitHub repository:

**Service A — `personagen-mail`**

1. Click **+ New Service** → **App**
2. Source: GitHub → select the PersonaGen repo
3. Set **Dockerfile Path** to `services/mail/Dockerfile`
4. Set **Service Name** to `personagen-mail`
5. Enable ports: `3000` (API), `25` (SMTP), `993` (IMAP)

**Service B — `personagen-factory`**

1. Click **+ New Service** → **App**
2. Source: GitHub → select the PersonaGen repo
3. Set **Dockerfile Path** to `services/factory/Dockerfile`
4. Set **Service Name** to `personagen-factory`
5. Enable port: `4000`

### Step 2: Set Environment Variables

Configure environment variables for each service. See the [Environment Variables Checklist](./env-vars-checklist.md) for the complete reference.

**Minimum required for `personagen-factory`:**

```env
FACTORY_PORT=4000
FACTORY_API_KEY=<generate-a-strong-key>
MAIL_URL=http://personagen-mail:3000
MAIL_API_KEY=<must-match-mail-service-ADMIN_API_KEY>
N8N_WEBHOOK_URL=https://auto.l2gseo.com/webhook/personagen-factory
ENCRYPTION_KEY=<generate-32-byte-hex>
```

**Minimum required for `personagen-mail`:**

```env
MAIL_DOMAIN=mail.yourdomain.com
ADMIN_API_KEY=<generate-a-strong-key>
API_PORT=3000
DKIM_SELECTOR=default
```

> [!IMPORTANT]
> `MAIL_API_KEY` on the factory service **must match** `ADMIN_API_KEY` on the mail service. These are how the services authenticate with each other.

### Step 3: Configure DNS

Add these DNS records in Cloudflare for the mail service:

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| A | `mail` | `<your-vps-ip>` | ❌ DNS only |
| MX | `@` | `mail.yourdomain.com` | — |
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
curl https://factory.yourdomain.com/health

# Check mail health
curl http://mail.yourdomain.com:3000/health

# Test email creation
curl -X POST http://mail.yourdomain.com:3000/api/mailbox \
  -H "Authorization: Bearer <ADMIN_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"address": "test@yourdomain.com"}'
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

*Monarch Stack — Fractional CTO Services*
